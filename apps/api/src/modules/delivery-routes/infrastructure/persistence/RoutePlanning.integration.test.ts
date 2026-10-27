import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDataSource } from '../../../../infrastructure/database/data-source.js';
import { RoutePlanningTypeOrmStore } from '../../../../infrastructure/dispatch/RoutePlanningTypeOrmStore.js';
import { DeliveryOrderTypeOrmRepository } from '../../../delivery-orders/infrastructure/persistence/DeliveryOrderTypeOrmRepository.js';
import { DeliveryOrder } from '../../../delivery-orders/domain/entities/DeliveryOrder.js';
import { Recipient } from '../../../delivery-orders/domain/value-objects/Recipient.js';
import { DeliveryAddress } from '../../../delivery-orders/domain/value-objects/DeliveryAddress.js';
import { Package } from '../../../delivery-orders/domain/value-objects/Package.js';
import { Organization } from '../../../identity-and-access/domain/entities/Organization.js';
import { OrganizationTypeOrmRepository } from '../../../identity-and-access/infrastructure/persistence/OrganizationTypeOrmRepository.js';
import type { PlannedRoute } from '../../application/ports/RoutePlanningStore.js';
import { probeIntegrationDatabase } from '../../../delivery-orders/infrastructure/persistence/test-database.js';

const CREATED_AT = '2026-10-27T15:00:00.000Z';
const probe = await probeIntegrationDatabase();
if (!probe.available) {
  process.stderr.write(`[delivery-routes:integration] Skipping PostgreSQL tests: ${probe.reason}.\n`);
}
const databaseUrl = probe.available ? probe.url : null;

describe.skipIf(databaseUrl === null)('Route planning transaction (PostgreSQL)', () => {
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
      for (const table of ['delivery_stop_orders', 'delivery_order_status_history',
        'delivery_orders', 'delivery_stops', 'delivery_routes', 'drivers', 'vehicles']) {
        await source.query(`DELETE FROM "${table}" WHERE "organization_id" = ANY($1::uuid[])`,
          [organizationIds]);
      }
      await source.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [organizationIds]);
    }
    await source.destroy();
  });

  async function seed() {
    const organizationId = randomUUID();
    const driverId = randomUUID();
    const vehicleId = randomUUID();
    organizationIds.push(organizationId);
    await new OrganizationTypeOrmRepository(source).save(Organization.create({
      id: organizationId, name: 'Route integration', createdAt: CREATED_AT,
    }));
    await source.query(`INSERT INTO drivers
      (id, organization_id, full_name, document_number, phone, license_number, status, created_at, updated_at)
      VALUES ($1,$2,'Test Driver',$3,'+51 911 222 333',$4,'active',$5,$5)`,
    [driverId, organizationId, `DNI-${driverId.slice(0, 8).toUpperCase()}`,
      `L-${driverId.slice(0, 8).toUpperCase()}`, CREATED_AT]);
    await source.query(`INSERT INTO vehicles
      (id, organization_id, plate, type, capacity_kg, status, created_at, updated_at)
      VALUES ($1,$2,$3,'van',800,'active',$4,$4)`,
    [vehicleId, organizationId, `R${vehicleId.slice(0, 6).toUpperCase()}`, CREATED_AT]);
    const makeOrder = async (code: string) => {
      const order = DeliveryOrder.create({
        id: randomUUID(), organizationId, publicCode: code,
        recipient: Recipient.create({ name: 'Ana Torres', phone: '+51 987 654 321' }),
        deliveryAddress: DeliveryAddress.create({ addressLine: 'Av. Arequipa 1234', district: 'Lince' }),
        packages: [Package.create({ code: 'PKG-001', description: 'Parcel' })],
        createdAt: CREATED_AT,
      });
      await orders.save(order);
      return order.id;
    };
    return { organizationId, driverId, vehicleId, makeOrder };
  }

  function plannedRoute(organizationId: string, driverId: string, vehicleId: string,
    orderIds: string[]): PlannedRoute {
    return {
      id: randomUUID(), organizationId, driverId, vehicleId,
      publicCode: `ROUTE-${randomUUID().slice(0, 8).toUpperCase()}`,
      plannedDate: '2026-10-27', status: 'planned', createdAt: CREATED_AT,
      stops: [{ id: randomUUID(), sequence: 1, addressLine: 'Av. Arequipa 1234',
        latitude: null, longitude: null, orderIds }],
    };
  }

  it('commits ordered links and both audited order transitions; rejects active reuse', async () => {
    const { organizationId, driverId, vehicleId, makeOrder } = await seed();
    const first = await makeOrder('ORDER-ROUTE-1');
    const second = await makeOrder('ORDER-ROUTE-2');
    const route = plannedRoute(organizationId, driverId, vehicleId, [first, second]);
    const actor = randomUUID();
    await expect(store.plan(route, actor)).resolves.toEqual(route);
    await expect(store.findById(organizationId, route.id)).resolves.toEqual(route);
    await expect(store.findById(randomUUID(), route.id)).resolves.toBeNull();
    for (const id of [first, second]) {
      expect((await orders.findById(id))?.status).toBe('assigned');
      expect((await orders.findById(id))?.activeRouteId).toBe(route.id);
      const history = await orders.findStatusHistory(organizationId, id);
      expect(history.map((event) => [event.fromStatus, event.toStatus, event.actorUserId]))
        .toEqual([['created', 'planned', actor], ['planned', 'assigned', actor]]);
    }
    const links = await source.query<{ order_id: string }[]>(
      'SELECT order_id FROM delivery_stop_orders WHERE route_id = $1 ORDER BY order_id', [route.id]);
    expect(links.map((link) => link.order_id)).toEqual([first, second].sort());
    const third = await makeOrder('ORDER-ROUTE-3');
    const competing = plannedRoute(organizationId, driverId, vehicleId, [third]);
    await expect(store.plan(competing, actor)).rejects.toThrow();
    expect((await orders.findById(third))?.status).toBe('created');
    expect(await orders.findStatusHistory(organizationId, third)).toEqual([]);
  });

  it('rolls back route, stops, links and order changes after a failed audit insert', async () => {
    const { organizationId, driverId, vehicleId, makeOrder } = await seed();
    const orderId = await makeOrder('ORDER-ROLLBACK-1');
    const route = plannedRoute(organizationId, driverId, vehicleId, [orderId]);
    await expect(store.plan(route, 'invalid-actor-id')).rejects.toThrow();
    expect((await orders.findById(orderId))?.status).toBe('created');
    expect((await orders.findById(orderId))?.activeRouteId).toBeNull();
    expect(await orders.findStatusHistory(organizationId, orderId)).toEqual([]);
    for (const table of ['delivery_routes', 'delivery_stops', 'delivery_stop_orders']) {
      const result = await source.query<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM "${table}" WHERE organization_id=$1`, [organizationId]);
      expect(result[0]?.count).toBe(0);
    }
  });

  it('rejects cross-tenant driver and stop/order links at the database boundary', async () => {
    const first = await seed();
    const second = await seed();
    const firstOrderId = await first.makeOrder('CROSS-ORG-1');
    const foreign = plannedRoute(second.organizationId, first.driverId, second.vehicleId, [firstOrderId]);
    await expect(source.query(`INSERT INTO delivery_routes
      (id, organization_id, public_code, planned_date, driver_id, vehicle_id, status, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,'planned',$7)`, [foreign.id, foreign.organizationId,
      foreign.publicCode, foreign.plannedDate, foreign.driverId, foreign.vehicleId, CREATED_AT]))
      .rejects.toThrow();
    const ownRoute = plannedRoute(first.organizationId, first.driverId, first.vehicleId, [firstOrderId]);
    await store.plan(ownRoute, randomUUID());
    const stopId = ownRoute.stops[0]?.id;
    expect(stopId).toBeDefined();
    await expect(source.query(`INSERT INTO delivery_stop_orders
      (id, organization_id, route_id, stop_id, order_id, position, active, created_at)
      VALUES ($1,$2,$3,$4,$5,1,true,$6)`, [randomUUID(), second.organizationId,
      ownRoute.id, stopId, firstOrderId, CREATED_AT])).rejects.toThrow();
  });

  it('commits only one concurrent plan for the same order on different resources', async () => {
    const { organizationId, driverId, vehicleId, makeOrder } = await seed();
    const alternateDriverId = randomUUID();
    const alternateVehicleId = randomUUID();
    await source.query(`INSERT INTO drivers
      (id, organization_id, full_name, document_number, phone, license_number, status, created_at, updated_at)
      VALUES ($1,$2,'Alternate Driver',$3,'+51 911 222 333',$4,'active',$5,$5)`,
    [alternateDriverId, organizationId, `DNI-${alternateDriverId.slice(0, 8).toUpperCase()}`,
      `L-${alternateDriverId.slice(0, 8).toUpperCase()}`, CREATED_AT]);
    await source.query(`INSERT INTO vehicles
      (id, organization_id, plate, type, capacity_kg, status, created_at, updated_at)
      VALUES ($1,$2,$3,'van',800,'active',$4,$4)`,
    [alternateVehicleId, organizationId,
      `R${alternateVehicleId.slice(0, 6).toUpperCase()}`, CREATED_AT]);
    const id = await makeOrder('CONCURRENT-1');
    const first = plannedRoute(organizationId, driverId, vehicleId, [id]);
    const second = plannedRoute(organizationId, alternateDriverId, alternateVehicleId, [id]);
    const results = await Promise.allSettled([
      store.plan(first, randomUUID()), store.plan(second, randomUUID()),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await orders.findById(id))?.status).toBe('assigned');
    expect([first.id, second.id]).toContain((await orders.findById(id))?.activeRouteId);
    expect(await orders.findStatusHistory(organizationId, id)).toHaveLength(2);
    const links = await source.query<{ count: number }[]>(
      'SELECT count(*)::int AS count FROM delivery_stop_orders WHERE order_id = $1 AND active = true', [id]);
    expect(links[0]?.count).toBe(1);
  });
});
