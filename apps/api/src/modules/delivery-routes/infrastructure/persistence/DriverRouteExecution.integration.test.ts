import { createHash, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDataSource } from '../../../../infrastructure/database/data-source.js';
import { DriverRouteTypeOrmStore } from '../../../../infrastructure/dispatch/DriverRouteTypeOrmStore.js';
import { DriverAccountTypeOrmStore } from '../../../../infrastructure/dispatch/DriverAccountTypeOrmStore.js';
import { RoutePlanningTypeOrmStore } from '../../../../infrastructure/dispatch/RoutePlanningTypeOrmStore.js';
import { DeliveryEvidenceTypeOrmStore } from '../../../delivery-execution/infrastructure/persistence/DeliveryEvidenceTypeOrmStore.js';
import { RoutePositionTypeOrmStore } from '../../../delivery-tracking/infrastructure/RoutePositionTypeOrmStore.js';
import { DeliveryEvidenceConflictError, DeliveryEvidenceNotFoundError } from '../../../delivery-execution/domain/errors/DeliveryExecutionError.js';
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
  let evidence: DeliveryEvidenceTypeOrmStore;
  let orders: DeliveryOrderTypeOrmRepository;
  const organizations: string[] = [];

  beforeAll(async () => {
    source = createDataSource({ url: url as string });
    await source.initialize();
    planner = new RoutePlanningTypeOrmStore(source);
    execution = new DriverRouteTypeOrmStore(source);
    evidence = new DeliveryEvidenceTypeOrmStore(source);
    orders = new DeliveryOrderTypeOrmRepository(source);
  });

  afterAll(async () => {
    if (!source?.isInitialized) return;
    await source.query(`DELETE FROM delivery_order_packages WHERE delivery_order_id IN
      (SELECT id FROM delivery_orders WHERE organization_id = ANY($1::uuid[]))`, [organizations]);
    for (const table of ['delivery_evidence', 'delivery_incidents', 'delivery_attempts', 'driver_account_binding_history',
      'delivery_route_status_history', 'delivery_order_status_history',
      'route_positions',
      'delivery_stop_orders', 'delivery_orders',
      'delivery_stops', 'delivery_routes', 'driver_accounts', 'drivers', 'vehicles', 'users']) {
      await source.query(`DELETE FROM "${table}" WHERE organization_id = ANY($1::uuid[])`, [organizations]);
    }
    await source.query('DELETE FROM customers WHERE organization_id = ANY($1::uuid[])', [organizations]);
    await source.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [organizations]);
    await source.destroy();
  });

  async function seed() {
    const organizationId = randomUUID();
    const customerId = randomUUID();
    const driverId = randomUUID();
    const vehicleId = randomUUID();
    const actorId = randomUUID();
    const adminId = randomUUID();
    organizations.push(organizationId);
    await new OrganizationTypeOrmRepository(source).save(Organization.create({
      id: organizationId, name: 'Driver execution integration', createdAt: AT,
    }));
    await source.query(`INSERT INTO customers
      (id, organization_id, public_code, name, contact_name, contact_email, contact_phone, status, created_at)
      VALUES ($1,$2,'TEST-CUSTOMER','Integration Customer','Test Contact','execution@example.test','+51 900 000 001','active',$3)`,
    [customerId, organizationId, AT]);
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
        id: randomUUID(), organizationId, customerId, publicCode: code, timeWindow: 'AM',
        recipient: Recipient.create({ name: 'Ana Torres', phone: '+51 987 654 321' }),
        deliveryAddress: DeliveryAddress.create({ addressLine: 'Av. Arequipa 1234', district: 'Lince' }),
        packages: [Package.create({ code: 'PKG-001', description: 'Parcel' })], createdAt: AT,
      });
      await orders.save(order);
      return order.id;
    };
    const plan = async (ids: string[], origin?: PlannedRoute['origin'],
      simulatedCompletionEnabled = false) => {
      const route: PlannedRoute = {
        id: randomUUID(), organizationId, driverId, vehicleId,
        publicCode: `EXEC-${randomUUID().slice(0, 8)}`,
        plannedDate: '2026-10-27', status: 'planned', createdAt: AT,
        ...(origin === undefined ? {} : { origin }),
        simulatedCompletionEnabled,
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
    const snapshots = await Promise.all(['delivery_routes', 'delivery_orders', 'delivery_attempts',
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
    await source.query(`UPDATE delivery_stops SET latitude=-12.05, longitude=-77.03
      WHERE organization_id=$1 AND route_id=$2`, [ctx.organizationId, route.id]);
    // Simulated routes now start at planning; mark this started route to exercise GPS storage.
    await source.query(`UPDATE delivery_routes SET simulated_completion_enabled=true
      WHERE organization_id=$1 AND id=$2`, [ctx.organizationId, route.id]);
    const positions = new RoutePositionTypeOrmStore(source);
    const activeRoutes = (await positions.findActiveRoutes())
      .filter((activeRoute) => activeRoute.organizationId === ctx.organizationId);
    expect(activeRoutes).toHaveLength(1);
    expect(activeRoutes[0]).toMatchObject({
      organizationId: ctx.organizationId,
      routeId: route.id,
      driverId: ctx.driverId,
      stops: [{ latitude: -12.05, longitude: -77.03 }],
    });
    const position = {
      organizationId: ctx.organizationId, routeId: route.id, driverId: ctx.driverId,
      latitude: -12.05, longitude: -77.03, accuracyMeters: 5,
      speedMetersPerSecond: 0, source: 'simulated' as const,
      recordedAt: AT, receivedAt: AT,
    };
    await expect(positions.record(position)).resolves.toBe(true);
    await expect(positions.record({ ...position, organizationId: randomUUID() })).resolves.toBe(false);
    expect(await source.query(`SELECT id FROM route_positions WHERE organization_id=$1`,
      [ctx.organizationId])).toHaveLength(1);
    await expect(positions.findLatestForRoutes(ctx.organizationId, [route.id])).resolves.toMatchObject([
      { organizationId: ctx.organizationId, routeId: route.id,
        latitude: -12.05, longitude: -77.03, source: 'simulated' },
    ]);
    await expect(positions.findLatestForRoutes(randomUUID(), [route.id])).resolves.toEqual([]);
    await expect(positions.pruneReceivedBefore('2026-10-28T00:00:00.000Z')).resolves.toBe(1);
    await expect(positions.pruneReceivedBefore('2026-10-28T00:00:00.000Z')).resolves.toBe(0);
    const attempts = await source.query<{ id: string; order_id: string; attempt_number: number; status: string }[]>(
      `SELECT id, order_id, attempt_number, status FROM delivery_attempts
        WHERE organization_id=$1 AND route_id=$2 ORDER BY order_id`,
      [ctx.organizationId, route.id]);
    expect(attempts).toHaveLength(ids.length);
    expect(attempts.every((attempt) => attempt.attempt_number === 1 && attempt.status === 'in_progress'))
      .toBe(true);
    const reserve = (orderId: string, actorUserId: string, key: string, byteSize = 16,
      checksum = 'a'.repeat(64)) => evidence.reserveUpload({
      id: randomUUID(), organizationId: ctx.organizationId, orderId, actorUserId,
      idempotencyKey: key, mimeType: 'image/jpeg', byteSize, checksum, createdAt: AT,
    });
    expect(await source.query(
      `SELECT id FROM delivery_evidence WHERE organization_id=$1 AND attempt_id=$2`,
      [ctx.organizationId, attempts.find((attempt) => attempt.order_id === ids[0])?.id],
    )).toHaveLength(0);
    const firstEvidence = await reserve(ids[0]!, ctx.actorId, 'delivery-photo-1');
    expect(firstEvidence).toMatchObject({
      orderId: ids[0], status: 'pending_upload',
      attemptId: attempts.find((attempt) => attempt.order_id === ids[0])?.id,
    });
    const retriedEvidence = await evidence.reserveUpload({
      id: randomUUID(), organizationId: ctx.organizationId, orderId: ids[0]!,
      actorUserId: ctx.actorId, idempotencyKey: 'delivery-photo-1',
      mimeType: 'image/jpeg', byteSize: 16, checksum: 'a'.repeat(64), createdAt: AT,
    });
    expect(retriedEvidence.id).toBe(firstEvidence.id);
    await expect(evidence.reserveUpload({
      id: randomUUID(), organizationId: ctx.organizationId, orderId: ids[0]!,
      actorUserId: ctx.actorId, idempotencyKey: 'delivery-photo-1',
      mimeType: 'image/jpeg', byteSize: 16, checksum: 'b'.repeat(64), createdAt: AT,
    })).rejects.toBeInstanceOf(DeliveryEvidenceConflictError);
    await expect(reserve(ids[0]!, ctx.actorId, 'delivery-photo-2'))
      .resolves.toMatchObject({ status: 'pending_upload' });
    await expect(reserve(ids[0]!, ctx.actorId, 'delivery-photo-3'))
      .rejects.toBeInstanceOf(DeliveryEvidenceConflictError);
    await expect(reserve(ids[0]!, ctx.adminId, 'admin-photo-1'))
      .rejects.toBeInstanceOf(DeliveryEvidenceNotFoundError);
    await expect(evidence.listForOrder(randomUUID(), ids[0]!, ctx.actorId))
      .rejects.toBeInstanceOf(DeliveryEvidenceNotFoundError);
    const available = await evidence.markAvailable(ctx.organizationId, firstEvidence.id, AT);
    expect(available.status).toBe('available');
    await expect(evidence.findForDownload(ctx.organizationId, firstEvidence.id, ctx.actorId))
      .resolves.toMatchObject({ objectKey: firstEvidence.objectKey, checksum: 'a'.repeat(64) });
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
    await source.query(`UPDATE delivery_routes SET status='completed' WHERE id=$1 AND organization_id=$2`,
      [route.id, ctx.organizationId]);
    expect((await positions.findActiveRoutes())
      .filter((activeRoute) => activeRoute.organizationId === ctx.organizationId)).toEqual([]);
    await expect(positions.record(position)).resolves.toBe(false);
  });

  it('persists the optional route origin and bound agent context for GPS simulation', async () => {
    const ctx = await seed();
    const origin = { addressLine: 'Starting location', latitude: -11.9740702, longitude: -77.0814464 };
    const route = await ctx.plan([await ctx.createOrder('EXEC-ORIGIN-1')], origin, true);
    await ctx.bind();

    const active = await new RoutePositionTypeOrmStore(source).findActiveRoutes();
    expect(active.every((activeRoute) => activeRoute.simulatedCompletionEnabled)).toBe(true);
    expect(active).toContainEqual(expect.objectContaining({
      organizationId: ctx.organizationId, routeId: route.id, driverId: ctx.driverId,
      driverUserId: ctx.actorId,
      simulatedCompletionEnabled: true,
      origin: { addressLine: origin.addressLine, latitude: -11.97407, longitude: -77.081446 },
      stops: [{ latitude: null, longitude: null }],
    }));
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
    expect((await source.query(`SELECT id FROM delivery_attempts WHERE route_id=$1`,
      [route.id]))).toHaveLength(1);
  });

  it('serializes concurrent evidence reservations at the two-photo attempt limit', async () => {
    const ctx = await seed();
    const orderId = await ctx.createOrder('EXEC-EVIDENCE-RACE-1');
    const route = await ctx.plan([orderId]);
    await ctx.bind();
    await execution.start(ctx.organizationId, route.id, ctx.actorId, AT);
    const reservations = await Promise.allSettled([1, 2, 3].map((number) =>
      evidence.reserveUpload({
        id: randomUUID(), organizationId: ctx.organizationId, orderId,
        actorUserId: ctx.actorId, idempotencyKey: `evidence-race-${number}`,
        mimeType: 'image/jpeg', byteSize: 16, checksum: String(number).repeat(64), createdAt: AT,
      })));

    expect(reservations.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(reservations.filter((result) => result.status === 'rejected' &&
      result.reason instanceof DeliveryEvidenceConflictError)).toHaveLength(1);
    const stored = await source.query<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM delivery_evidence WHERE order_id=$1`, [orderId]);
    expect(stored[0]?.count).toBe('2');
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

  it('keeps the running route visible and prevents a second active assignment', async () => {
    const ctx = await seed();
    const first = await ctx.plan([await ctx.createOrder('EXEC-PRIORITY-1')]);
    await ctx.bind();
    await execution.start(ctx.organizationId, first.id, ctx.actorId, AT);
    const nextOrderId = await ctx.createOrder('EXEC-PRIORITY-2');
    const nextVehicleId = randomUUID();
    await source.query(`INSERT INTO vehicles (id, organization_id, plate, type,
      capacity_kg, status, created_at, updated_at)
      VALUES ($1,$2,$3,'van',800,'active',$4,$4)`,
    [nextVehicleId, ctx.organizationId, `V${nextVehicleId.slice(0, 6).toUpperCase()}`, AT]);
    const before = await hash(ctx.organizationId);
    const second: PlannedRoute = {
      ...first, id: randomUUID(), publicCode: `EXEC-${randomUUID().slice(0, 8)}`,
      vehicleId: nextVehicleId,
      stops: [{ ...first.stops[0]!, id: randomUUID(), orderIds: [nextOrderId] }],
    };
    await expect(planner.plan(second, ctx.adminId)).rejects.toThrow();
    expect(await hash(ctx.organizationId)).toBe(before);
    expect((await execution.mine(ctx.organizationId, ctx.actorId)).id).toBe(first.id);
    expect((await orders.findById(nextOrderId))?.status).toBe('created');
  });

  it('confirms one order only with available evidence and leaves route completion explicit', async () => {
    const ctx = await seed();
    const orderId = await ctx.createOrder('EXEC-CONFIRM-1');
    const otherOrderId = await ctx.createOrder('EXEC-CONFIRM-2');
    const route = await ctx.plan([orderId, otherOrderId]);
    await ctx.bind();
    await execution.start(ctx.organizationId, route.id, ctx.actorId, AT);
    const attempt = (await source.query<{ id: string }[]>(
      'SELECT id FROM delivery_attempts WHERE order_id=$1', [orderId]))[0]!;
    const otherAttempt = (await source.query<{ id: string }[]>(
      'SELECT id FROM delivery_attempts WHERE order_id=$1', [otherOrderId]))[0]!;
    const pending = await evidence.reserveUpload({
      id: randomUUID(), organizationId: ctx.organizationId, orderId,
      actorUserId: ctx.actorId, idempotencyKey: 'confirm-pending',
      mimeType: 'image/jpeg', byteSize: 16, checksum: 'c'.repeat(64), createdAt: AT,
    });
    const secondPhoto = await evidence.reserveUpload({
      id: randomUUID(), organizationId: ctx.organizationId, orderId,
      actorUserId: ctx.actorId, idempotencyKey: 'confirm-photo-2',
      mimeType: 'image/jpeg', byteSize: 16, checksum: 'b'.repeat(64), createdAt: AT,
    });
    const otherAttemptPhoto = await evidence.reserveUpload({
      id: randomUUID(), organizationId: ctx.organizationId, orderId: otherOrderId,
      actorUserId: ctx.actorId, idempotencyKey: 'wrong-attempt-photo',
      mimeType: 'image/jpeg', byteSize: 16, checksum: 'a'.repeat(64), createdAt: AT,
    });
    const beforeRejected = await hash(ctx.organizationId);
    await expect(execution.confirmDelivery(ctx.organizationId, orderId, ctx.actorId,
      { evidenceIds: [pending.id], receiverName: 'Ana Torres', notes: null }, AT)).rejects.toThrow();
    await expect(execution.confirmDelivery(ctx.organizationId, orderId, ctx.adminId,
      { evidenceIds: [pending.id], receiverName: 'Ana Torres', notes: null }, AT)).rejects.toThrow();
    await expect(execution.confirmDelivery(ctx.organizationId, orderId, ctx.actorId,
      { evidenceIds: [pending.id, pending.id], receiverName: null, notes: null }, AT)).rejects.toThrow();
    expect(await hash(ctx.organizationId)).toBe(beforeRejected);

    const available = await evidence.markAvailable(ctx.organizationId, pending.id, AT);
    await evidence.markAvailable(ctx.organizationId, secondPhoto.id, AT);
    await evidence.markAvailable(ctx.organizationId, otherAttemptPhoto.id, AT);
    expect(available.status).toBe('available');
    await expect(execution.confirmDelivery(ctx.organizationId, orderId, ctx.actorId,
      { evidenceIds: [otherAttemptPhoto.id], receiverName: null, notes: null }, AT)).rejects.toThrow();
    const alternateDriverId = randomUUID();
    const alternateUserId = randomUUID();
    await source.query(`INSERT INTO users (id, organization_id, email, password_hash, role,
      status, created_at) VALUES ($1,$2,$3,'test-hash','DRIVER','active',$4)`,
    [alternateUserId, ctx.organizationId, `${alternateUserId}@example.test`, AT]);
    await source.query(`INSERT INTO drivers (id, organization_id, full_name, document_number,
      phone, license_number, status, created_at, updated_at)
      VALUES ($1,$2,'Other Driver',$3,'+51 911 222 335',$4,'active',$5,$5)`,
    [alternateDriverId, ctx.organizationId, `DNI-${alternateDriverId.slice(0, 8).toUpperCase()}`,
      `L-${alternateDriverId.slice(0, 8).toUpperCase()}`, AT]);
    await source.query(`INSERT INTO driver_accounts (organization_id, driver_id, user_id)
      VALUES ($1,$2,$3)`, [ctx.organizationId, alternateDriverId, alternateUserId]);
    await expect(execution.confirmDelivery(ctx.organizationId, orderId, alternateUserId,
      { evidenceIds: [pending.id], receiverName: null, notes: null }, AT)).rejects.toThrow();
    expect(await hash(ctx.organizationId)).toBe(beforeRejected);
    const confirmations = await Promise.allSettled([1, 2].map(() =>
      execution.confirmDelivery(ctx.organizationId, orderId, ctx.actorId,
        { evidenceIds: [pending.id, secondPhoto.id], receiverName: 'Ana Torres', notes: null }, AT)));
    expect(confirmations.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);

    expect((await orders.findById(orderId))?.status).toBe('delivered');
    expect(await source.query(
      `SELECT id FROM delivery_attempts WHERE id=$1 AND status='delivered' AND completed_at IS NOT NULL`,
      [attempt.id])).toHaveLength(1);
    expect((await orders.findStatusHistory(ctx.organizationId, orderId)).at(-1))
      .toMatchObject({ fromStatus: 'in_transit', toStatus: 'delivered', actorUserId: ctx.actorId });
    expect((await planner.findById(ctx.organizationId, route.id))?.status).toBe('in_progress');
    await expect(execution.confirmDelivery(ctx.organizationId, orderId, ctx.actorId,
      { evidenceIds: [pending.id], receiverName: null, notes: null }, AT)).rejects.toThrow();
    expect((await orders.findById(otherOrderId))?.status).toBe('in_transit');
    expect(otherAttempt.id).not.toBe(attempt.id);
  });

  it('atomically completes an arrived single-delivery simulation without fabricating photo evidence', async () => {
    const ctx = await seed();
    const orderId = await ctx.createOrder('EXEC-SIMULATED-1');
    const route = await ctx.plan([orderId]);
    await ctx.bind();
    await execution.start(ctx.organizationId, route.id, ctx.actorId, AT);
    const beforeUnauthorized = await hash(ctx.organizationId);
    await expect(execution.completeSimulated(ctx.organizationId, route.id, ctx.driverId,
      ctx.adminId, AT)).rejects.toThrow();
    expect(await hash(ctx.organizationId)).toBe(beforeUnauthorized);

    const completed = await execution.completeSimulated(ctx.organizationId, route.id,
      ctx.driverId, ctx.actorId, '2026-10-27T15:10:00.000Z');
    expect(completed).toMatchObject({ id: route.id, status: 'completed' });
    expect((await orders.findById(orderId))?.status).toBe('delivered');
    const attempts = await source.query<{ status: string; receiver_name: string | null;
      delivery_notes: string | null; completed_at: Date | null }[]>(
      `SELECT status, receiver_name, delivery_notes, completed_at FROM delivery_attempts
       WHERE organization_id=$1 AND route_id=$2`, [ctx.organizationId, route.id]);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ status: 'delivered', receiver_name: null,
      delivery_notes: expect.stringContaining('SIMULATED:') });
    expect(attempts[0]?.completed_at).not.toBeNull();
    expect(await source.query(`SELECT id FROM delivery_evidence WHERE organization_id=$1 AND order_id=$2`,
      [ctx.organizationId, orderId])).toHaveLength(0);
    expect((await orders.findStatusHistory(ctx.organizationId, orderId)).at(-1))
      .toMatchObject({ fromStatus: 'in_transit', toStatus: 'delivered', actorUserId: ctx.actorId });
    const historyCount = await source.query<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM delivery_route_status_history WHERE route_id=$1`, [route.id]);
    await execution.completeSimulated(ctx.organizationId, route.id, ctx.driverId, ctx.actorId,
      '2026-10-27T15:20:00.000Z');
    expect(await source.query<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM delivery_route_status_history WHERE route_id=$1`, [route.id]))
      .toEqual(historyCount);
  });

  it('denies private evidence download to another driver in the same organization', async () => {
    const ctx = await seed();
    const orderId = await ctx.createOrder('EXEC-EVIDENCE-PRIVATE-1');
    const route = await ctx.plan([orderId]);
    await ctx.bind();
    await execution.start(ctx.organizationId, route.id, ctx.actorId, AT);
    const upload = await evidence.reserveUpload({
      id: randomUUID(), organizationId: ctx.organizationId, orderId,
      actorUserId: ctx.actorId, idempotencyKey: 'private-download-photo',
      mimeType: 'image/jpeg', byteSize: 16, checksum: 'a'.repeat(64), createdAt: AT,
    });
    await evidence.markAvailable(ctx.organizationId, upload.id, AT);

    const otherUserId = randomUUID();
    const otherDriverId = randomUUID();
    await source.query(`INSERT INTO users (id, organization_id, email, password_hash, role,
      status, created_at) VALUES ($1,$2,$3,'test-hash','DRIVER','active',$4)`,
    [otherUserId, ctx.organizationId, `${otherUserId}@example.test`, AT]);
    await source.query(`INSERT INTO drivers (id, organization_id, full_name, document_number,
      phone, license_number, status, created_at, updated_at)
      VALUES ($1,$2,'Other Driver',$3,'+51 911 222 335',$4,'active',$5,$5)`,
    [otherDriverId, ctx.organizationId, `DNI-${otherDriverId.slice(0, 8).toUpperCase()}`,
      `L-${otherDriverId.slice(0, 8).toUpperCase()}`, AT]);
    await source.query(`INSERT INTO driver_accounts (organization_id, driver_id, user_id)
      VALUES ($1,$2,$3)`, [ctx.organizationId, otherDriverId, otherUserId]);

    const before = await source.query(
      `SELECT id, status, available_at FROM delivery_evidence
        WHERE organization_id=$1 ORDER BY id`, [ctx.organizationId]);
    await expect(evidence.findForDownload(ctx.organizationId, upload.id, otherUserId))
      .rejects.toBeInstanceOf(DeliveryEvidenceNotFoundError);
    expect(await source.query(
      `SELECT id, status, available_at FROM delivery_evidence
        WHERE organization_id=$1 ORDER BY id`, [ctx.organizationId])).toEqual(before);
    await expect(evidence.findForDownload(ctx.organizationId, upload.id, ctx.actorId))
      .resolves.toMatchObject({ id: upload.id, status: 'available' });
  });

  it('atomically records a photographed incident, failed attempt, returned order and audit', async () => {
    const ctx = await seed();
    const orderId = await ctx.createOrder('EXEC-INCIDENT-1');
    const route = await ctx.plan([orderId]);
    await ctx.bind();
    await execution.start(ctx.organizationId, route.id, ctx.actorId, AT);
    const attempt = (await source.query<{ id: string }[]>(
      'SELECT id FROM delivery_attempts WHERE order_id=$1', [orderId]))[0]!;
    const upload = await evidence.reserveUpload({
      id: randomUUID(), organizationId: ctx.organizationId, orderId,
      actorUserId: ctx.actorId, idempotencyKey: 'incident-photo',
      mimeType: 'image/jpeg', byteSize: 16, checksum: 'd'.repeat(64), createdAt: AT,
    });
    await evidence.markAvailable(ctx.organizationId, upload.id, AT);
    const beforeInvalidIncident = await hash(ctx.organizationId);
    await expect(execution.reportDeliveryIncident(ctx.organizationId, orderId, ctx.actorId, {
      category: 'invalid-category', description: 'Should roll back', evidenceIds: [upload.id],
    }, AT)).rejects.toThrow();
    expect(await hash(ctx.organizationId)).toBe(beforeInvalidIncident);
    expect(await source.query(
      'SELECT id FROM delivery_incidents WHERE organization_id=$1', [ctx.organizationId]))
      .toHaveLength(0);

    await source.query(`CREATE FUNCTION reject_failed_attempt_for_test() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.status='failed' THEN RAISE EXCEPTION 'forced attempt update failure'; END IF;
        RETURN NEW;
      END $$`);
    await source.query(`CREATE TRIGGER reject_failed_attempt_for_test
      BEFORE UPDATE ON delivery_attempts FOR EACH ROW
      EXECUTE FUNCTION reject_failed_attempt_for_test()`);
    try {
      await expect(execution.reportDeliveryIncident(ctx.organizationId, orderId, ctx.actorId, {
        category: 'recipient_absent', description: 'Forced transaction rollback',
        evidenceIds: [upload.id],
      }, AT)).rejects.toThrow();
    } finally {
      await source.query('DROP TRIGGER reject_failed_attempt_for_test ON delivery_attempts');
      await source.query('DROP FUNCTION reject_failed_attempt_for_test()');
    }
    expect(await hash(ctx.organizationId)).toBe(beforeInvalidIncident);
    expect(await source.query(
      'SELECT id FROM delivery_incidents WHERE organization_id=$1', [ctx.organizationId]))
      .toHaveLength(0);
    expect(await source.query(
      'SELECT id FROM delivery_evidence WHERE id=$1 AND incident_id IS NULL', [upload.id]))
      .toHaveLength(1);

    const result = await execution.reportDeliveryIncident(ctx.organizationId, orderId, ctx.actorId, {
      category: 'recipient_absent', description: 'Recipient was not available',
      evidenceIds: [upload.id],
    }, AT);

    expect(result.incident).toMatchObject({ category: 'recipient_absent', description: 'Recipient was not available' });
    expect((await orders.findById(orderId))?.status).toBe('returned');
    expect(await source.query(
      `SELECT id FROM delivery_attempts WHERE id=$1 AND status='failed' AND completed_at IS NOT NULL`,
      [attempt.id])).toHaveLength(1);
    expect(await source.query(
      `SELECT id FROM delivery_evidence WHERE id=$1 AND incident_id=$2 AND status='available'`,
      [upload.id, result.incident.id])).toHaveLength(1);
    expect((await orders.findStatusHistory(ctx.organizationId, orderId)).at(-1))
      .toMatchObject({ fromStatus: 'in_transit', toStatus: 'returned', actorUserId: ctx.actorId });
    const completed = await execution.complete(ctx.organizationId, route.id, ctx.actorId, AT);
    expect(completed.status).toBe('completed');
    const redispatched = await ctx.plan([orderId]);
    expect(redispatched.id).not.toBe(route.id);
    expect((await orders.findById(orderId))?.status).toBe('assigned');
    expect((await orders.findStatusHistory(ctx.organizationId, orderId)).slice(-2)
      .map((entry) => [entry.fromStatus, entry.toStatus]))
      .toEqual([['returned', 'planned'], ['planned', 'assigned']]);
  });

  it('completes a route explicitly only when all active stop orders have outcomes', async () => {
    const ctx = await seed();
    const ids = [await ctx.createOrder('EXEC-ROUTE-DONE-1'), await ctx.createOrder('EXEC-ROUTE-DONE-2')];
    const route = await ctx.plan(ids);
    await ctx.bind();
    await execution.start(ctx.organizationId, route.id, ctx.actorId, AT);
    const before = await hash(ctx.organizationId);
    await expect(execution.complete(ctx.organizationId, route.id, ctx.actorId, AT)).rejects.toThrow();
    expect(await hash(ctx.organizationId)).toBe(before);
    const attempt = (await source.query<{ id: string }[]>(
      'SELECT id FROM delivery_attempts WHERE order_id=$1', [ids[0]]))[0]!;
    const upload = await evidence.reserveUpload({
      id: randomUUID(), organizationId: ctx.organizationId, orderId: ids[0]!,
      actorUserId: ctx.actorId, idempotencyKey: 'route-complete-photo',
      mimeType: 'image/jpeg', byteSize: 16, checksum: 'e'.repeat(64), createdAt: AT,
    });
    await evidence.markAvailable(ctx.organizationId, upload.id, AT);
    await execution.confirmDelivery(ctx.organizationId, ids[0]!, ctx.actorId,
      { evidenceIds: [upload.id], receiverName: null, notes: null }, AT);
    const secondPhoto = await evidence.reserveUpload({
      id: randomUUID(), organizationId: ctx.organizationId, orderId: ids[1]!,
      actorUserId: ctx.actorId, idempotencyKey: 'route-complete-incident-photo',
      mimeType: 'image/jpeg', byteSize: 16, checksum: 'f'.repeat(64), createdAt: AT,
    });
    await evidence.markAvailable(ctx.organizationId, secondPhoto.id, AT);
    await execution.reportDeliveryIncident(ctx.organizationId, ids[1]!, ctx.actorId, {
      category: 'other', description: 'Other delivery issue', evidenceIds: [secondPhoto.id],
    }, AT);
    const completed = await execution.complete(ctx.organizationId, route.id, ctx.actorId, AT);
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).not.toBeNull();
    expect(await source.query(
      `SELECT id FROM delivery_attempts WHERE id=$1 AND status='delivered'`, [attempt.id])).toHaveLength(1);
    expect(await source.query(
      `SELECT id FROM delivery_route_status_history WHERE route_id=$1 AND to_status='completed'`,
      [route.id])).toHaveLength(1);
  });
});
