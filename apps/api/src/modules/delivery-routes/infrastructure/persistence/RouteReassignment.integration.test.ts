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
import type { RoutePlanDraft } from '../../application/ports/RoutePlanningStore.js';
import { probeIntegrationDatabase } from '../../../delivery-orders/infrastructure/persistence/test-database.js';

const CREATED_AT = '2026-10-27T15:00:00.000Z';
const probe = await probeIntegrationDatabase();
if (!probe.available) {
  process.stderr.write(`[delivery-routes:reassign] Skipping PostgreSQL tests: ${probe.reason}.\n`);
}
const databaseUrl = probe.available ? probe.url : null;

describe.skipIf(databaseUrl === null)('Route reassignment transaction (PostgreSQL)', () => {
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
      await source.query('DELETE FROM customers WHERE organization_id = ANY($1::uuid[])', [organizationIds]);
      await source.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [organizationIds]);
    }
    await source.destroy();
  });

  async function seed() {
    const organizationId = randomUUID();
    const customerId = randomUUID();
    const driverId = randomUUID();
    const vehicleId = randomUUID();
    organizationIds.push(organizationId);
    await new OrganizationTypeOrmRepository(source).save(Organization.create({
      id: organizationId, name: 'Reassign integration', createdAt: CREATED_AT }));
    await source.query(`INSERT INTO customers
      (id, organization_id, public_code, name, contact_name, contact_email, contact_phone, status, created_at)
      VALUES ($1,$2,'TEST-CUSTOMER','Integration Customer','Test Contact','reassign@example.test','+51 900 000 001','active',$3)`,
    [customerId, organizationId, CREATED_AT]);
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
        id: randomUUID(), organizationId, customerId, publicCode: code, timeWindow: 'AM',
        recipient: Recipient.create({ name: 'Ana Torres', phone: '+51 987 654 321' }),
        deliveryAddress: DeliveryAddress.create({ addressLine: 'Av. Arequipa 1234', district: 'Lince',
          latitude: -12.084, longitude: -77.035 }),
        packages: [Package.create({ code: 'PKG-001', description: 'Parcel' })],
        createdAt: CREATED_AT });
      await orders.save(order);
      return order.id;
    };
    return { organizationId, driverId, vehicleId, makeOrder };
  }

  async function addDriver(organizationId: string, label: string) {
    const id = randomUUID();
    await source.query(`INSERT INTO drivers
      (id, organization_id, full_name, document_number, phone, license_number, status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,'+51 911 222 333',$5,'active',$6,$6)`,
    [id, organizationId, label, `DNI-${id.slice(0, 8).toUpperCase()}`,
      `L-${id.slice(0, 8).toUpperCase()}`, CREATED_AT]);
    return id;
  }

  async function addVehicle(organizationId: string) {
    const id = randomUUID();
    await source.query(`INSERT INTO vehicles
      (id, organization_id, plate, type, capacity_kg, status, created_at, updated_at)
      VALUES ($1,$2,$3,'van',800,'active',$4,$4)`,
    [id, organizationId, `V${id.slice(0, 6).toUpperCase()}`, CREATED_AT]);
    return id;
  }

  function plannedRoute(organizationId: string, driverId: string, vehicleId: string,
    orderIds: string[]): RoutePlanDraft {
    return {
      id: randomUUID(), organizationId, driverId, vehicleId,
      publicCode: `ROUTE-${randomUUID().slice(0, 8).toUpperCase()}`,
      plannedDate: '2026-10-27', status: 'planned', createdAt: CREATED_AT,
      stops: orderIds.map((orderId, index) => ({ id: randomUUID(), sequence: index + 1, orderId })) };
  }

  async function snapshot(organizationId: string) {
    const [row] = await source.query<{
      orders: string; history: string; stops: string; links: string;
    }[]>(`SELECT
      (SELECT coalesce(md5(string_agg(id::text||status||coalesce(active_route_id::text,'-')||updated_at::text,'|' ORDER BY id)),'') FROM delivery_orders WHERE organization_id=$1) AS orders,
      (SELECT coalesce(md5(string_agg(id::text||order_id::text||from_status||to_status||occurred_at::text,'|' ORDER BY id)),'') FROM delivery_order_status_history WHERE organization_id=$1) AS history,
      (SELECT coalesce(md5(string_agg(id::text||route_id::text||sequence::text||address_line,'|' ORDER BY id)),'') FROM delivery_stops WHERE organization_id=$1) AS stops,
      (SELECT coalesce(md5(string_agg(id::text||stop_id::text||order_id::text||position::text||active::text,'|' ORDER BY id)),'') FROM delivery_stop_orders WHERE organization_id=$1) AS links`,
    [organizationId]);
    return row;
  }

  it('leaves stops, links, orders and history byte-identical after reassignment', async () => {
    const { organizationId, driverId, vehicleId, makeOrder } = await seed();
    const alternateDriverId = await addDriver(organizationId, 'Alternate Driver');
    const alternateVehicleId = await addVehicle(organizationId);
    const firstOrderId = await makeOrder('REASSIGN-SNAP-1');
    const secondOrderId = await makeOrder('REASSIGN-SNAP-2');
    const route = plannedRoute(organizationId, driverId, vehicleId, [firstOrderId, secondOrderId]);
    const planned = await store.plan(route, randomUUID());
    const before = await snapshot(organizationId);
    const updated = await store.reassign(organizationId, route.id,
      { driverId: alternateDriverId, vehicleId: alternateVehicleId });
    expect(updated).toMatchObject({ id: route.id, driverId: alternateDriverId,
      vehicleId: alternateVehicleId, status: 'planned', stops: planned.stops });
    expect(await snapshot(organizationId)).toEqual(before);
    await expect(store.findById(organizationId, route.id)).resolves
      .toMatchObject({ driverId: alternateDriverId, vehicleId: alternateVehicleId });
    const drivers = await source.query<{ driver_id: string }[]>(
      'SELECT driver_id FROM delivery_routes WHERE id = $1', [route.id]);
    expect(drivers[0]?.driver_id).toBe(alternateDriverId);
  });

  it('rolls back the driver half when the vehicle is already on another active route', async () => {
    const { organizationId, driverId, vehicleId, makeOrder } = await seed();
    const spareDriverId = await addDriver(organizationId, 'Spare Driver');
    const busyVehicleId = await addVehicle(organizationId);
    const busyDriverId = await addDriver(organizationId, 'Busy Driver');
    const route = plannedRoute(organizationId, driverId, vehicleId,
      [await makeOrder('REASSIGN-ROLLBACK-1')]);
    const busyRoute = plannedRoute(organizationId, busyDriverId, busyVehicleId,
      [await makeOrder('REASSIGN-ROLLBACK-2')]);
    await store.plan(route, randomUUID());
    await store.plan(busyRoute, randomUUID());
    await expect(store.reassign(organizationId, route.id,
      { driverId: spareDriverId, vehicleId: busyVehicleId })).rejects.toThrow();
    const rows = await source.query<{ driver_id: string; vehicle_id: string }[]>(
      'SELECT driver_id, vehicle_id FROM delivery_routes WHERE id = $1', [route.id]);
    expect(rows[0]).toEqual({ driver_id: driverId, vehicle_id: vehicleId });
    await expect(store.findById(organizationId, route.id)).resolves
      .toMatchObject({ driverId, vehicleId });
  });

  it('serializes two concurrent reassignments that target the same driver', async () => {
    const { organizationId, driverId, vehicleId, makeOrder } = await seed();
    const targetDriverId = await addDriver(organizationId, 'Target Driver');
    const secondDriverId = await addDriver(organizationId, 'Second Driver');
    const secondVehicleId = await addVehicle(organizationId);
    const firstRoute = plannedRoute(organizationId, driverId, vehicleId,
      [await makeOrder('REASSIGN-RACE-1')]);
    const secondRoute = plannedRoute(organizationId, secondDriverId, secondVehicleId,
      [await makeOrder('REASSIGN-RACE-2')]);
    await store.plan(firstRoute, randomUUID());
    await store.plan(secondRoute, randomUUID());
    const results = await Promise.allSettled([
      store.reassign(organizationId, firstRoute.id, { driverId: targetDriverId }),
      store.reassign(organizationId, secondRoute.id, { driverId: targetDriverId })]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const active = await source.query<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM delivery_routes
       WHERE driver_id = $1 AND status IN ('planned', 'in_progress')`, [targetDriverId]);
    expect(active[0]?.count).toBe(1);
    const both = await source.query<{ id: string; driver_id: string }[]>(
      'SELECT id, driver_id FROM delivery_routes WHERE id = ANY($1::uuid[]) ORDER BY id',
    [[firstRoute.id, secondRoute.id]]);
    expect(both.filter((row) => row.driver_id === targetDriverId)).toHaveLength(1);
    expect(both).toHaveLength(2);
  });
});
