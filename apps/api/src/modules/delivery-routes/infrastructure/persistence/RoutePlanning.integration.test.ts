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

  it('redispatches a returned order atomically without losing its prior route or audit', async () => {
    const { organizationId, driverId, vehicleId, makeOrder } = await seed();
    const id = await makeOrder('RETURN-RETRY-1');
    const first = plannedRoute(organizationId, driverId, vehicleId, [id]);
    const actor = randomUUID();
    await store.plan(first, actor);
    const returnedAt = '2026-10-27T16:00:00.000Z';
    await source.query(`UPDATE delivery_orders SET status='returned', updated_at=$2
      WHERE id=$1`, [id, returnedAt]);
    await source.query(`INSERT INTO delivery_order_status_history
      (id, order_id, organization_id, from_status, to_status, actor_user_id, occurred_at)
      VALUES ($1,$2,$3,'assigned','returned',$4,$5)`, [randomUUID(), id, organizationId, actor, returnedAt]);
    const original = await orders.findStatusHistory(organizationId, id);
    const second = plannedRoute(organizationId, driverId, vehicleId, [id]);
    // The original route is no longer reserving its resources after execution.
    await source.query(`UPDATE delivery_routes SET status='completed' WHERE id=$1`, [first.id]);
    await expect(store.plan(second, actor)).resolves.toEqual(second);
    expect((await orders.findById(id))?.activeRouteId).toBe(second.id);
    expect((await orders.findById(id))?.status).toBe('assigned');
    const history = await orders.findStatusHistory(organizationId, id);
    expect(history.slice(0, original.length)).toEqual(original);
    expect(history.slice(original.length).map((entry) => [entry.fromStatus, entry.toStatus]))
      .toEqual([['returned', 'planned'], ['planned', 'assigned']]);
    expect(Date.parse(history.at(-2)?.occurredAt ?? '')).toBeGreaterThan(Date.parse(returnedAt));
    const links = await source.query<{ route_id: string; active: boolean }[]>(
      'SELECT route_id, active FROM delivery_stop_orders WHERE order_id=$1 ORDER BY created_at, route_id', [id]);
    expect(links).toHaveLength(2);
    expect(links.find((link) => link.route_id === first.id)?.active).toBe(false);
    expect(links.find((link) => link.route_id === second.id)?.active).toBe(true);
    await expect(store.plan(plannedRoute(organizationId, driverId, vehicleId, [id]), actor))
      .rejects.toThrow();
    expect(await orders.findStatusHistory(organizationId, id)).toEqual(history);
  });

  it('commits only one concurrent redispatch for the same returned order', async () => {
    const { organizationId, driverId, vehicleId, makeOrder } = await seed();
    const id = await makeOrder('CONCURRENT-RETURN-1');
    const actor = randomUUID();
    const previous = plannedRoute(organizationId, driverId, vehicleId, [id]);
    await store.plan(previous, actor);
    const returnedAt = '2026-10-27T16:00:00.000Z';
    await source.query(`UPDATE delivery_orders SET status='returned', updated_at=$2 WHERE id=$1`,
      [id, returnedAt]);
    await source.query(`INSERT INTO delivery_order_status_history
      (id, order_id, organization_id, from_status, to_status, actor_user_id, occurred_at)
      VALUES ($1,$2,$3,'assigned','returned',$4,$5)`, [randomUUID(), id, organizationId, actor, returnedAt]);
    await source.query(`UPDATE delivery_routes SET status='completed' WHERE id=$1`, [previous.id]);
    const alternateDriver = randomUUID();
    const alternateVehicle = randomUUID();
    await source.query(`INSERT INTO drivers
      (id, organization_id, full_name, document_number, phone, license_number, status, created_at, updated_at)
      VALUES ($1,$2,'Alternate Driver',$3,'+51 911 222 333',$4,'active',$5,$5)`,
    [alternateDriver, organizationId, `DNI-${alternateDriver.slice(0, 8).toUpperCase()}`,
      `L-${alternateDriver.slice(0, 8).toUpperCase()}`, CREATED_AT]);
    await source.query(`INSERT INTO vehicles
      (id, organization_id, plate, type, capacity_kg, status, created_at, updated_at)
      VALUES ($1,$2,$3,'van',800,'active',$4,$4)`,
    [alternateVehicle, organizationId, `R${alternateVehicle.slice(0, 6).toUpperCase()}`, CREATED_AT]);
    const before = await orders.findStatusHistory(organizationId, id);
    const first = plannedRoute(organizationId, driverId, vehicleId, [id]);
    const second = plannedRoute(organizationId, alternateDriver, alternateVehicle, [id]);
    const outcomes = await Promise.allSettled([store.plan(first, actor), store.plan(second, actor)]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const winner = outcomes[0]?.status === 'fulfilled' ? first : second;
    const loser = winner === first ? second : first;
    expect((await orders.findById(id))?.activeRouteId).toBe(winner.id);
    expect((await orders.findById(id))?.status).toBe('assigned');
    expect(await store.findById(organizationId, loser.id)).toBeNull();
    const history = await orders.findStatusHistory(organizationId, id);
    expect(history.slice(0, before.length)).toEqual(before);
    expect(history.slice(before.length).map(({ fromStatus, toStatus }) => [fromStatus, toStatus]))
      .toEqual([['returned', 'planned'], ['planned', 'assigned']]);
    const links = await source.query<{ route_id: string; active: boolean }[]>(
      'SELECT route_id, active FROM delivery_stop_orders WHERE order_id=$1 ORDER BY created_at, route_id', [id]);
    expect(links).toHaveLength(2);
    expect(links.find((link) => link.route_id === previous.id)?.active).toBe(false);
    expect(links.find((link) => link.route_id === winner.id)?.active).toBe(true);
  });

  it('restores the prior link and returned order when retry audit insertion fails', async () => {
    const { organizationId, driverId, vehicleId, makeOrder } = await seed();
    const id = await makeOrder('RETURN-ROLLBACK-1');
    const first = plannedRoute(organizationId, driverId, vehicleId, [id]);
    await store.plan(first, randomUUID());
    const returnedAt = '2026-10-27T16:00:00.000Z';
    await source.query(`UPDATE delivery_orders SET status='returned', updated_at=$2 WHERE id=$1`,
      [id, returnedAt]);
    await source.query(`UPDATE delivery_routes SET status='completed' WHERE id=$1`, [first.id]);
    const history = await orders.findStatusHistory(organizationId, id);
    const second = plannedRoute(organizationId, driverId, vehicleId, [id]);
    await expect(store.plan(second, 'invalid-actor-id')).rejects.toThrow();
    expect((await orders.findById(id))?.status).toBe('returned');
    expect((await orders.findById(id))?.activeRouteId).toBe(first.id);
    expect(await orders.findStatusHistory(organizationId, id)).toEqual(history);
    expect(await store.findById(organizationId, second.id)).toBeNull();
    const links = await source.query<{ route_id: string; active: boolean }[]>(
      'SELECT route_id, active FROM delivery_stop_orders WHERE order_id=$1', [id]);
    expect(links).toEqual([{ route_id: first.id, active: true }]);
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

  it('reassigns resources without touching orders or history and rejects busy resources', async () => {
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
    const firstOrderId = await makeOrder('REASSIGN-DB-1');
    const firstRoute = plannedRoute(organizationId, driverId, vehicleId, [firstOrderId]);
    const actor = randomUUID();
    await store.plan(firstRoute, actor);
    const historyBefore = await orders.findStatusHistory(organizationId, firstOrderId);
    const reassigned = await store.reassign(organizationId, firstRoute.id,
      { driverId: alternateDriverId, vehicleId: alternateVehicleId });
    expect(reassigned.driverId).toBe(alternateDriverId);
    expect(reassigned.vehicleId).toBe(alternateVehicleId);
    await expect(store.findById(organizationId, firstRoute.id))
      .resolves.toMatchObject({ driverId: alternateDriverId, vehicleId: alternateVehicleId });
    expect((await orders.findById(firstOrderId))?.status).toBe('assigned');
    expect(await orders.findStatusHistory(organizationId, firstOrderId)).toEqual(historyBefore);

    const secondOrderId = await makeOrder('REASSIGN-DB-2');
    const secondRoute = plannedRoute(organizationId, driverId, vehicleId, [secondOrderId]);
    await store.plan(secondRoute, actor);
    await expect(store.reassign(organizationId, secondRoute.id, { driverId: alternateDriverId }))
      .rejects.toThrow();
    await expect(store.findById(organizationId, secondRoute.id))
      .resolves.toMatchObject({ driverId, vehicleId });
    await expect(store.reassign(randomUUID(), secondRoute.id, { driverId }))
      .rejects.toThrow();
  });
});
