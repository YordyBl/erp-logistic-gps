import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDataSource } from '../../../../infrastructure/database/data-source.js';
import { RoutePlanningTypeOrmStore } from '../../../../infrastructure/dispatch/RoutePlanningTypeOrmStore.js';
import { DriverRouteStatsTypeOrmQuery } from '../../../../infrastructure/dispatch/DriverRouteStatsTypeOrmQuery.js';
import { VehicleRouteStatsTypeOrmQuery } from '../../../../infrastructure/dispatch/VehicleRouteStatsTypeOrmQuery.js';
import { InMemoryDeliveryOrderRepository } from '../../../delivery-orders/composition/composition-root.js';
import { DeliveryOrder } from '../../../delivery-orders/domain/entities/DeliveryOrder.js';
import { DeliveryAddress } from '../../../delivery-orders/domain/value-objects/DeliveryAddress.js';
import { Package } from '../../../delivery-orders/domain/value-objects/Package.js';
import { Recipient } from '../../../delivery-orders/domain/value-objects/Recipient.js';
import { DeliveryOrderTypeOrmRepository } from '../../../delivery-orders/infrastructure/persistence/DeliveryOrderTypeOrmRepository.js';
import { probeIntegrationDatabase } from '../../../delivery-orders/infrastructure/persistence/test-database.js';
import { Organization } from '../../../identity-and-access/domain/entities/Organization.js';
import { OrganizationTypeOrmRepository } from '../../../identity-and-access/infrastructure/persistence/OrganizationTypeOrmRepository.js';
import type { RoutePageCriteria, RoutePlanDraft } from '../../application/ports/RoutePlanningStore.js';
import { InMemoryRoutePlanningStore } from '../../composition/composition-root.js';

const CREATED_AT = '2026-10-27T15:00:00.000Z';
const probe = await probeIntegrationDatabase();
if (!probe.available) {
  process.stderr.write(`[delivery-routes:integration] Skipping PostgreSQL tests: ${probe.reason}.\n`);
}
const databaseUrl = probe.available ? probe.url : null;

describe.skipIf(databaseUrl === null)('Route listing and vehicle route stats (PostgreSQL)', () => {
  let source: DataSource;
  let store: RoutePlanningTypeOrmStore;
  let orders: DeliveryOrderTypeOrmRepository;
  const organizationIds: string[] = [];

  beforeAll(async () => {
    source = createDataSource({ url: databaseUrl as string });
    await source.initialize();
    store = new RoutePlanningTypeOrmStore(source);
    orders = new DeliveryOrderTypeOrmRepository(source);
  });

  afterAll(async () => {
    if (!source?.isInitialized) return;
    if (organizationIds.length > 0) {
      for (const table of ['delivery_stop_orders', 'delivery_order_status_history', 'delivery_orders',
        'delivery_stops', 'delivery_routes', 'drivers', 'vehicles', 'customers']) {
        await source.query(`DELETE FROM "${table}" WHERE "organization_id" = ANY($1::uuid[])`, [organizationIds]);
      }
      await source.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [organizationIds]);
    }
    await source.destroy();
  });

  /** An organization with one customer and the given crews (driver name, plate). */
  async function seedOrganization(crews: readonly (readonly [string, string])[]) {
    const organizationId = randomUUID();
    const customerId = randomUUID();
    organizationIds.push(organizationId);
    await new OrganizationTypeOrmRepository(source).save(Organization.create({
      id: organizationId, name: 'Route list integration', createdAt: CREATED_AT,
    }));
    await source.query(`INSERT INTO customers
      (id, organization_id, public_code, name, contact_name, contact_email, contact_phone, status, created_at)
      VALUES ($1,$2,'TEST-CUSTOMER','Integration Customer','Test Contact','routes@example.test','+51 900 000 001','active',$3)`,
    [customerId, organizationId, CREATED_AT]);
    const memoryOrders = new InMemoryDeliveryOrderRepository();
    const names = new Map<string, string>();
    const plates = new Map<string, string>();
    const resources: { readonly driverId: string; readonly vehicleId: string }[] = [];
    for (const [fullName, plate] of crews) {
      const driverId = randomUUID();
      const vehicleId = randomUUID();
      await source.query(`INSERT INTO drivers
        (id, organization_id, full_name, document_number, phone, license_number, status, created_at, updated_at)
        VALUES ($1,$2,$3,$4,'+51 911 222 333',$5,'active',$6,$6)`,
      [driverId, organizationId, fullName, `DNI-${driverId.slice(0, 8).toUpperCase()}`,
        `L-${driverId.slice(0, 8).toUpperCase()}`, CREATED_AT]);
      await source.query(`INSERT INTO vehicles
        (id, organization_id, plate, type, capacity_kg, status, created_at, updated_at)
        VALUES ($1,$2,$3,'van',800,'active',$4,$4)`, [vehicleId, organizationId, plate, CREATED_AT]);
      names.set(driverId, fullName);
      plates.set(vehicleId, plate);
      resources.push({ driverId, vehicleId });
    }
    const memory = new InMemoryRoutePlanningStore(memoryOrders, undefined, undefined,
      { execute: async (input: unknown) => {
        const { driverId } = input as { driverId: string };
        const fullName = names.get(driverId);
        if (fullName === undefined) throw new Error('unknown driver');
        return { driver: { fullName } } as never;
      } },
      { execute: async (input: unknown) => {
        const { vehicleId } = input as { vehicleId: string };
        const plate = plates.get(vehicleId);
        if (plate === undefined) throw new Error('unknown vehicle');
        return { vehicle: { plate } } as never;
      } });

    /**
     * Plans a route (one stop per order) in PostgreSQL and, unless `mirror` is false, the same
     * route in memory. The in-memory planner never reuses a crew, even after a route closes.
     */
    const plan = async (crew: number, overrides: Partial<RoutePlanDraft> & { readonly orderCount?: number },
      mirror = true) => {
      const { driverId, vehicleId } = resources[crew]!;
      const { orderCount = 1, ...fields } = overrides;
      const orderIds: string[] = [];
      for (let index = 0; index < orderCount; index += 1) {
        const order = DeliveryOrder.create({
          id: randomUUID(), organizationId, customerId, publicCode: `ORD-${randomUUID().slice(0, 8)}`,
          timeWindow: 'AM', recipient: Recipient.create({ name: 'Ana Torres', phone: '+51 987 654 321' }),
          deliveryAddress: DeliveryAddress.create({
            addressLine: 'Av. Arequipa 1234', district: 'Lince', latitude: -12.084, longitude: -77.035,
          }),
          packages: [Package.create({ code: 'PKG-001', description: 'Parcel' })],
          createdAt: CREATED_AT,
        });
        await orders.save(order);
        await memoryOrders.save(order);
        orderIds.push(order.id);
      }
      const draft: RoutePlanDraft = {
        id: randomUUID(), organizationId, driverId, vehicleId,
        publicCode: `RUT-${randomUUID().slice(0, 8).toUpperCase()}`,
        plannedDate: '2026-10-27', status: 'planned', createdAt: CREATED_AT,
        stops: orderIds.map((orderId, index) => ({ id: randomUUID(), sequence: index + 1, orderId })),
        ...fields,
      };
      const actor = randomUUID();
      await store.plan(draft, actor);
      if (mirror) await memory.plan(draft, actor);
      return draft;
    };
    return { organizationId, resources, memory, plan };
  }

  it('pages, filters, searches and counts like the in-memory adapter', async () => {
    const owner = await seedOrganization([
      ['Luis Quispe', 'ABC-101'], ['Rosa Medina', 'DEF-202'], ['Marta 50% Paz', 'GHI-303'], ['Ana Rojas', 'JKL-404'],
    ]);
    const foreign = await seedOrganization([['Luis Foráneo', 'ABC-999']]);
    const routes = [
      await owner.plan(0, { publicCode: 'RUT-B', plannedDate: '2026-11-02', createdAt: '2026-10-27T15:00:00.000Z' }),
      await owner.plan(1, { publicCode: 'RUT-A', plannedDate: '2026-11-05', createdAt: '2026-10-27T16:00:00.000Z', orderCount: 2 }),
      await owner.plan(2, { publicCode: 'RUT-D', plannedDate: '2026-11-02', createdAt: '2026-10-27T17:00:00.000Z' }),
      await owner.plan(3, { publicCode: 'RUT-C', plannedDate: '2026-11-03', createdAt: '2026-10-27T17:00:00.000Z' }),
    ];
    const foreignRoute = await foreign.plan(0, { publicCode: 'RUT-B', plannedDate: '2026-11-02' });

    const base = { page: 1, pageSize: 20, sort: { field: 'plannedDate', direction: 'desc' } } as const;
    const scenarios: RoutePageCriteria[] = [
      base,
      { ...base, page: 2, pageSize: 3 },
      { ...base, sort: { field: 'plannedDate', direction: 'asc' } },
      { ...base, sort: { field: 'publicCode', direction: 'asc' } },
      { ...base, sort: { field: 'publicCode', direction: 'desc' } },
      { ...base, sort: { field: 'status', direction: 'asc' } },
      { ...base, status: ['planned'] },
      { ...base, status: ['in_progress', 'completed'] },
      { ...base, q: 'rut-a' },
      { ...base, q: 'ROSA' },
      { ...base, q: 'ghi-3' },
      { ...base, q: '50%' },
      { ...base, q: '_' },
      { ...base, q: 'luis' },
      { ...base, ids: [routes[0]!.id, routes[2]!.id, foreignRoute.id] },
      { ...base, driverId: owner.resources[1]!.driverId },
      { ...base, vehicleId: owner.resources[3]!.vehicleId },
      { ...base, vehicleId: foreign.resources[0]!.vehicleId },
      { ...base, plannedFrom: '2026-11-03' },
      { ...base, plannedTo: '2026-11-02' },
      { ...base, plannedFrom: '2026-11-02', plannedTo: '2026-11-03', q: 'rut' },
      { ...base, page: 9 },
    ];
    for (const criteria of scenarios) {
      const [stored, inMemory] = await Promise.all([
        store.listPage(owner.organizationId, criteria),
        owner.memory.listPage(owner.organizationId, criteria),
      ]);
      expect(stored, JSON.stringify(criteria)).toEqual(inMemory);
    }

    const firstPage = await store.listPage(owner.organizationId, { ...base, pageSize: 3 });
    // plannedDate desc, then createdAt desc between the two 2 November routes.
    expect(firstPage.items.map((route) => route.publicCode)).toEqual(['RUT-A', 'RUT-C', 'RUT-D']);
    expect(firstPage.total).toBe(4);
    expect(firstPage.counts).toEqual({ status: { planned: 4, in_progress: 0, completed: 0 } });
    expect(firstPage.items[0]).toEqual(await store.findById(owner.organizationId, routes[1]!.id));
    expect(firstPage.items[0]!.stops).toHaveLength(2);
  });

  it('counts statuses without their own filter and never lists cancelled routes', async () => {
    const owner = await seedOrganization([['Luis Quispe', 'ABC-111'], ['Rosa Medina', 'DEF-222'], ['Ana Rojas', 'GHI-333']]);
    const [done, running, cancelled] = [
      await owner.plan(0, { plannedDate: '2026-11-01' }),
      await owner.plan(1, { plannedDate: '2026-11-02' }),
      await owner.plan(2, { plannedDate: '2026-11-03' }),
    ];
    await source.query(`UPDATE delivery_routes SET status='completed', started_at=$2, completed_at=$2 WHERE id=$1`,
      [done!.id, CREATED_AT]);
    await source.query(`UPDATE delivery_routes SET status='in_progress', started_at=$2 WHERE id=$1`,
      [running!.id, CREATED_AT]);
    await source.query(`UPDATE delivery_routes SET status='cancelled' WHERE id=$1`, [cancelled!.id]);
    const base = { page: 1, pageSize: 20, sort: { field: 'plannedDate', direction: 'desc' } } as const;

    const all = await store.listPage(owner.organizationId, base);
    expect(all.items.map((route) => route.id)).toEqual([running!.id, done!.id]);
    expect(all.counts).toEqual({ status: { planned: 0, in_progress: 1, completed: 1 } });

    const completed = await store.listPage(owner.organizationId, { ...base, status: ['completed'], q: 'luis' });
    expect(completed.items.map((route) => route.id)).toEqual([done!.id]);
    expect(completed.items[0]).toMatchObject({ status: 'completed', completedAt: CREATED_AT });
    expect(completed.counts).toEqual({ status: { planned: 0, in_progress: 0, completed: 1 } });
    const bySort = await store.listPage(owner.organizationId, { ...base, sort: { field: 'status', direction: 'asc' } });
    expect(bySort.items.map((route) => route.status)).toEqual(['completed', 'in_progress']);
  });

  it('aggregates vehicle route stats in SQL for the tenant only', async () => {
    const owner = await seedOrganization([['Luis Quispe', 'ABC-121'], ['Rosa Medina', 'DEF-232'], ['Ana Rojas', 'GHI-343']]);
    const foreign = await seedOrganization([['Luis Foráneo', 'ABC-998']]);
    const [crewA, crewB, idle] = owner.resources;
    const first = await owner.plan(0, { plannedDate: '2026-09-10', orderCount: 2 }, false);
    await source.query(`UPDATE delivery_routes SET status='completed' WHERE id=$1`, [first.id]);
    await owner.plan(0, { plannedDate: '2026-11-06', orderCount: 1 }, false);
    // Planned for next month: counts in the totals, outside the monthly window.
    const future = await owner.plan(1, { plannedDate: '2026-12-01', orderCount: 3 }, false);
    await source.query(`UPDATE delivery_routes SET status='completed' WHERE id=$1`, [future.id]);
    const cancelled = await owner.plan(1, { plannedDate: '2026-11-07', orderCount: 1 }, false);
    await source.query(`UPDATE delivery_routes SET status='cancelled' WHERE id=$1`, [cancelled.id]);
    await foreign.plan(0, { plannedDate: '2026-11-06', orderCount: 4 }, false);

    const stats = await new VehicleRouteStatsTypeOrmQuery(source)
      .getStats(owner.organizationId, { months: 3 }, new Date('2026-11-16T04:00:00.000Z'));

    const byVehicle = new Map(stats.map((item) => [item.vehicleId, item]));
    expect(stats).toHaveLength(3);
    expect(byVehicle.get(crewA!.vehicleId)).toEqual({
      vehicleId: crewA!.vehicleId, routes: 2, completed: 1, stops: 3, orders: 3, lastRouteDay: '2026-11-06',
      monthly: [{ month: '2026-09', routes: 1 }, { month: '2026-10', routes: 0 }, { month: '2026-11', routes: 1 }],
    });
    expect(byVehicle.get(crewB!.vehicleId)).toEqual({
      vehicleId: crewB!.vehicleId, routes: 1, completed: 1, stops: 3, orders: 3, lastRouteDay: '2026-12-01',
      monthly: [{ month: '2026-09', routes: 0 }, { month: '2026-10', routes: 0 }, { month: '2026-11', routes: 0 }],
    });
    expect(byVehicle.get(idle!.vehicleId)).toEqual({
      vehicleId: idle!.vehicleId, routes: 0, completed: 0, stops: 0, orders: 0, lastRouteDay: null,
      monthly: [{ month: '2026-09', routes: 0 }, { month: '2026-10', routes: 0 }, { month: '2026-11', routes: 0 }],
    });

    // The period bounds the totals only; the last route day stays the latest ever.
    const november = await new VehicleRouteStatsTypeOrmQuery(source).getStats(owner.organizationId,
      { months: 3, from: '2026-11-01', to: '2026-11-30', ids: [crewA!.vehicleId, crewB!.vehicleId, foreign.resources[0]!.vehicleId] },
      new Date('2026-11-16T04:00:00.000Z'));
    expect(november.map((item) => item.vehicleId).sort()).toEqual([crewA!.vehicleId, crewB!.vehicleId].sort());
    expect(november.find((item) => item.vehicleId === crewA!.vehicleId)).toMatchObject({
      routes: 1, completed: 0, stops: 1, orders: 1, lastRouteDay: '2026-11-06',
      monthly: [{ month: '2026-11', routes: 1 }],
    });
    expect(november.find((item) => item.vehicleId === crewB!.vehicleId)).toMatchObject({
      routes: 0, completed: 0, stops: 0, orders: 0, lastRouteDay: '2026-12-01',
    });

    const byDriver = new Map((await new DriverRouteStatsTypeOrmQuery(source)
      .getStats(owner.organizationId, { months: 3 }, new Date('2026-11-16T04:00:00.000Z')))
      .map((item) => [item.driverId, item]));
    expect(byDriver.size).toBe(3);
    expect(byDriver.get(crewA!.driverId)).toMatchObject({ routes: 2, completed: 1, stops: 3, orders: 3, lastRouteDay: '2026-11-06' });
    expect(byDriver.get(idle!.driverId)).toMatchObject({ routes: 0, lastRouteDay: null });
  });
});
