import { createHash, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDataSource } from '../../../../infrastructure/database/data-source.js';
import { DriverRouteTypeOrmStore } from '../../../../infrastructure/dispatch/DriverRouteTypeOrmStore.js';
import { DriverAccountTypeOrmStore } from '../../../../infrastructure/dispatch/DriverAccountTypeOrmStore.js';
import { RoutePlanningTypeOrmStore } from '../../../../infrastructure/dispatch/RoutePlanningTypeOrmStore.js';
import { DeliveryOrder } from '../../../delivery-orders/domain/entities/DeliveryOrder.js';
import { Recipient } from '../../../delivery-orders/domain/value-objects/Recipient.js';
import { DeliveryAddress } from '../../../delivery-orders/domain/value-objects/DeliveryAddress.js';
import { Package } from '../../../delivery-orders/domain/value-objects/Package.js';
import { DeliveryOrderTypeOrmRepository } from '../../../delivery-orders/infrastructure/persistence/DeliveryOrderTypeOrmRepository.js';
import { probeIntegrationDatabase } from '../../../delivery-orders/infrastructure/persistence/test-database.js';
import { Organization } from '../../../identity-and-access/domain/entities/Organization.js';
import { OrganizationTypeOrmRepository } from '../../../identity-and-access/infrastructure/persistence/OrganizationTypeOrmRepository.js';
import type { PlannedRoute } from '../../application/ports/RoutePlanningStore.js';

const probe = await probeIntegrationDatabase();
if (!probe.available) process.stderr.write(`[driver-route:integration] Skipping: ${probe.reason}.\n`);
const url = probe.available ? probe.url : null;
const AT = '2026-10-27T15:00:00.000Z';

describe.skipIf(url === null)('Driver route execution (PostgreSQL)', () => {
  let source: DataSource;
  let planner: RoutePlanningTypeOrmStore;
  let execution: DriverRouteTypeOrmStore;
  let orders: DeliveryOrderTypeOrmRepository;
  const organizations: string[] = [];

  beforeAll(async () => {
    source = createDataSource({ url: url as string });
    await source.initialize();
    planner = new RoutePlanningTypeOrmStore(source);
    execution = new DriverRouteTypeOrmStore(source);
    orders = new DeliveryOrderTypeOrmRepository(source);
  });

  afterAll(async () => {
    if (!source?.isInitialized) return;
    await source.query(`DELETE FROM delivery_order_packages WHERE delivery_order_id IN
      (SELECT id FROM delivery_orders WHERE organization_id = ANY($1::uuid[]))`, [organizations]);
    for (const table of ['driver_account_binding_history', 'delivery_route_status_history',
      'delivery_order_status_history',
      'delivery_stop_orders', 'delivery_orders',
      'delivery_stops', 'delivery_routes', 'driver_accounts', 'drivers', 'vehicles', 'users']) {
      await source.query(`DELETE FROM "${table}" WHERE organization_id = ANY($1::uuid[])`, [organizations]);
    }
    await source.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [organizations]);
    await source.destroy();
  });

  async function seed() {
    const organizationId = randomUUID();
    const driverId = randomUUID();
    const vehicleId = randomUUID();
    const actorId = randomUUID();
    const adminId = randomUUID();
    organizations.push(organizationId);
    await new OrganizationTypeOrmRepository(source).save(Organization.create({
      id: organizationId, name: 'Driver execution integration', createdAt: AT,
    }));
    for (const [id, role] of [[actorId, 'DRIVER'], [adminId, 'ADMIN']]) {
      await source.query(`INSERT INTO users (id, organization_id, email, password_hash, role,
        status, created_at) VALUES ($1,$2,$3,'test-hash',$4,'active',$5)`,
      [id, organizationId, `${id}@example.test`, role, AT]);
    }
    await source.query(`INSERT INTO drivers (id, organization_id, full_name, document_number,
      phone, license_number, status, created_at, updated_at)
      VALUES ($1,$2,'Test Driver',$3,'+51 911 222 333',$4,'active',$5,$5)`,
    [driverId, organizationId, `DNI-${driverId.slice(0, 8).toUpperCase()}`,
      `L-${driverId.slice(0, 8).toUpperCase()}`, AT]);
    await source.query(`INSERT INTO vehicles (id, organization_id, plate, type, capacity_kg,
      status, created_at, updated_at) VALUES ($1,$2,$3,'van',800,'active',$4,$4)`,
    [vehicleId, organizationId, `V${vehicleId.slice(0, 6).toUpperCase()}`, AT]);
    const createOrder = async (code: string) => {
      const order = DeliveryOrder.create({
        id: randomUUID(), organizationId, publicCode: code,
        recipient: Recipient.create({ name: 'Ana Torres', phone: '+51 987 654 321' }),
        deliveryAddress: DeliveryAddress.create({ addressLine: 'Av. Arequipa 1234', district: 'Lince' }),
        packages: [Package.create({ code: 'PKG-001', description: 'Parcel' })], createdAt: AT,
      });
      await orders.save(order);
      return order.id;
    };
    const plan = async (ids: string[]) => {
      const route: PlannedRoute = {
        id: randomUUID(), organizationId, driverId, vehicleId,
        publicCode: `EXEC-${randomUUID().slice(0, 8)}`,
        plannedDate: '2026-10-27', status: 'planned', createdAt: AT,
        stops: [{ id: randomUUID(), sequence: 1, addressLine: 'First stop',
          latitude: null, longitude: null, orderIds: ids }],
      };
      await planner.plan(route, adminId);
      return route;
    };
    const bind = async () => source.query(`INSERT INTO driver_accounts
      (organization_id, driver_id, user_id) VALUES ($1,$2,$3)`,
    [organizationId, driverId, actorId]);
    return { organizationId, driverId, actorId, adminId, createOrder, plan, bind };
  }

  async function hash(organizationId: string) {
    const snapshots = await Promise.all(['delivery_routes', 'delivery_orders',
      'delivery_route_status_history', 'delivery_order_status_history'].map(async (table) =>
      source.query(`SELECT * FROM "${table}" WHERE organization_id=$1 ORDER BY id`, [organizationId])));
    return createHash('sha256').update(JSON.stringify(snapshots)).digest('hex');
  }

  it('limits route reads to the linked account and starts all stop orders with audit once', async () => {
    const ctx = await seed();
    const ids = [await ctx.createOrder('EXEC-ORDER-1'), await ctx.createOrder('EXEC-ORDER-2')];
    const route = await ctx.plan(ids);
    const before = await hash(ctx.organizationId);
    await expect(execution.mine(ctx.organizationId, ctx.actorId)).rejects.toThrow();
    await expect(execution.start(ctx.organizationId, route.id, ctx.actorId, AT)).rejects.toThrow();
    expect(await hash(ctx.organizationId)).toBe(before);
    await ctx.bind();
    const view = await execution.mine(ctx.organizationId, ctx.actorId);
    expect(view).toMatchObject({ id: route.id, status: 'planned',
      stops: [{ orders: ids.map((id) => ({ id, status: 'assigned' })) }] });
    const started = await execution.start(ctx.organizationId, route.id, ctx.actorId, AT);
    expect(started).toMatchObject({ id: route.id, status: 'in_progress',
      stops: [{ orders: ids.map((id) => ({ id, status: 'in_transit' })) }] });
    expect((await execution.mine(ctx.organizationId, ctx.actorId)).startedAt).toBe(started.startedAt);
    expect((await planner.findById(ctx.organizationId, route.id))?.status).toBe('in_progress');
    for (const id of ids) {
      expect((await orders.findById(id))?.status).toBe('in_transit');
      expect((await orders.findStatusHistory(ctx.organizationId, id)).at(-1))
        .toMatchObject({ fromStatus: 'assigned', toStatus: 'in_transit', actorUserId: ctx.actorId });
    }
    const routeHistory = await source.query<{ actor_user_id: string }[]>(
      `SELECT actor_user_id FROM delivery_route_status_history WHERE route_id=$1`, [route.id]);
    expect(routeHistory).toEqual([{ actor_user_id: ctx.actorId }]);
    const after = await hash(ctx.organizationId);
    await expect(execution.start(ctx.organizationId, route.id, ctx.actorId, AT)).rejects.toThrow();
    expect(await hash(ctx.organizationId)).toBe(after);
    await expect(planner.reassign(ctx.organizationId, route.id, { driverId: randomUUID() }))
      .rejects.toThrow();
    expect(await hash(ctx.organizationId)).toBe(after);
  });

  it('rolls back start when one linked order is no longer assigned', async () => {
    const ctx = await seed();
    const ids = [await ctx.createOrder('EXEC-FAIL-1'), await ctx.createOrder('EXEC-FAIL-2')];
    const route = await ctx.plan(ids);
    await ctx.bind();
    await orders.cancel(ctx.organizationId, ids[1]!, ctx.adminId, '2026-10-27T15:00:01.000Z');
    const before = await hash(ctx.organizationId);
    await expect(execution.start(ctx.organizationId, route.id, ctx.actorId, AT)).rejects.toThrow();
    expect(await hash(ctx.organizationId)).toBe(before);
  });

  it('serializes two concurrent starts into one transition', async () => {
    const ctx = await seed();
    const route = await ctx.plan([await ctx.createOrder('EXEC-RACE-1')]);
    await ctx.bind();
    const results = await Promise.allSettled([
      execution.start(ctx.organizationId, route.id, ctx.actorId, AT),
      execution.start(ctx.organizationId, route.id, ctx.actorId, AT),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((await source.query(`SELECT id FROM delivery_route_status_history WHERE route_id=$1`,
      [route.id]))).toHaveLength(1);
  });

  it('rejects revoked, disabled and other-tenant accounts without changing route or audit', async () => {
    const ctx = await seed();
    const foreign = await seed();
    const route = await ctx.plan([await ctx.createOrder('EXEC-GUARD-1')]);
    await ctx.bind();
    await foreign.bind();
    let before = await hash(ctx.organizationId);
    await expect(execution.start(ctx.organizationId, route.id, foreign.actorId, AT))
      .rejects.toThrow();
    await expect(execution.mine(ctx.organizationId, foreign.actorId)).rejects.toThrow();
    expect(await hash(ctx.organizationId)).toBe(before);

    await source.query(`UPDATE users SET status='disabled' WHERE id=$1`, [ctx.actorId]);
    before = await hash(ctx.organizationId);
    await expect(execution.mine(ctx.organizationId, ctx.actorId)).rejects.toThrow();
    await expect(execution.start(ctx.organizationId, route.id, ctx.actorId, AT))
      .rejects.toThrow();
    expect(await hash(ctx.organizationId)).toBe(before);

    await source.query(`UPDATE users SET status='active' WHERE id=$1`, [ctx.actorId]);
    await source.query(`UPDATE drivers SET status='inactive' WHERE id=$1`, [ctx.driverId]);
    before = await hash(ctx.organizationId);
    await expect(execution.mine(ctx.organizationId, ctx.actorId)).rejects.toThrow();
    await expect(execution.start(ctx.organizationId, route.id, ctx.actorId, AT))
      .rejects.toThrow();
    expect(await hash(ctx.organizationId)).toBe(before);
    await source.query(`UPDATE drivers SET status='active' WHERE id=$1`, [ctx.driverId]);
    await source.query(`DELETE FROM driver_accounts WHERE organization_id=$1 AND user_id=$2`,
      [ctx.organizationId, ctx.actorId]);
    before = await hash(ctx.organizationId);
    await expect(execution.mine(ctx.organizationId, ctx.actorId)).rejects.toThrow();
    await expect(execution.start(ctx.organizationId, route.id, ctx.actorId, AT))
      .rejects.toThrow();
    expect(await hash(ctx.organizationId)).toBe(before);
  });

  it('serializes start versus reassignment without splitting route and order state', async () => {
    const ctx = await seed();
    const route = await ctx.plan([await ctx.createOrder('EXEC-REASSIGN-RACE-1')]);
    await ctx.bind();
    const replacementDriverId = randomUUID();
    await source.query(`INSERT INTO drivers (id, organization_id, full_name, document_number,
      phone, license_number, status, created_at, updated_at)
      VALUES ($1,$2,'Replacement Driver',$3,'+51 911 222 334',$4,'active',$5,$5)`,
    [replacementDriverId, ctx.organizationId,
      `DNI-${replacementDriverId.slice(0, 8).toUpperCase()}`,
      `L-${replacementDriverId.slice(0, 8).toUpperCase()}`, AT]);
    const results = await Promise.allSettled([
      execution.start(ctx.organizationId, route.id, ctx.actorId, AT),
      planner.reassign(ctx.organizationId, route.id, { driverId: replacementDriverId }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const current = await planner.findById(ctx.organizationId, route.id);
    const order = await orders.findById(route.stops[0]!.orderIds[0]!);
    const history = await source.query<{ to_status: string }[]>(
      `SELECT to_status FROM delivery_route_status_history WHERE route_id=$1`, [route.id]);
    if (current?.status === 'in_progress') {
      expect(current.driverId).toBe(ctx.driverId);
      expect(order?.status).toBe('in_transit');
      expect(history).toEqual([{ to_status: 'in_progress' }]);
    } else {
      expect(current?.driverId).toBe(replacementDriverId);
      expect(order?.status).toBe('assigned');
      expect(history).toEqual([]);
    }
  });

  it('serializes start against binding revocation without partial order transitions', async () => {
    const ctx = await seed();
    const route = await ctx.plan([await ctx.createOrder('EXEC-REVOKE-RACE-1')]);
    await ctx.bind();
    const bindings = new DriverAccountTypeOrmStore(source);
    const results = await Promise.allSettled([
      execution.start(ctx.organizationId, route.id, ctx.actorId, AT),
      bindings.bind(ctx.organizationId, ctx.driverId, null, ctx.adminId, AT),
    ]);
    expect(results[1]?.status).toBe('fulfilled');
    const current = await planner.findById(ctx.organizationId, route.id);
    const orderId = route.stops[0]!.orderIds[0]!;
    const order = await orders.findById(orderId);
    const routeHistory = await source.query<{ to_status: string }[]>(
      `SELECT to_status FROM delivery_route_status_history WHERE route_id=$1`, [route.id]);
    const orderHistory = await orders.findStatusHistory(ctx.organizationId, orderId);
    if (results[0]?.status === 'fulfilled') {
      expect(current?.status).toBe('in_progress');
      expect(order?.status).toBe('in_transit');
      expect(routeHistory).toEqual([{ to_status: 'in_progress' }]);
      expect(orderHistory.at(-1)).toMatchObject({ toStatus: 'in_transit', actorUserId: ctx.actorId });
    } else {
      expect(current?.status).toBe('planned');
      expect(order?.status).toBe('assigned');
      expect(routeHistory).toEqual([]);
      expect(orderHistory.at(-1)).toMatchObject({ toStatus: 'assigned' });
    }
    expect(await bindings.findDriverId(ctx.organizationId, ctx.actorId)).toBeNull();
    await expect(execution.mine(ctx.organizationId, ctx.actorId)).rejects.toThrow();
  });
});
