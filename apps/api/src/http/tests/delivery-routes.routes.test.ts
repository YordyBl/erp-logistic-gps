import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DeliveryOrder } from '../../modules/delivery-orders/domain/entities/DeliveryOrder.js';

import {
  ADMIN_ID, bearer, buildTestApp, DRIVER_EMAIL, DRIVER_ID,
  ORGANIZATION_ID, OTHER_ORGANIZATION_ID, OTHER_CUSTOMER_ID, validOrderBody,
} from './support/test-app.js';

const ROUTES = '/api/v1/delivery-routes';
const ORDERS = '/api/v1/delivery-orders';
/** One stop per order, in the given order: stops carry no location of their own. */
const stopsFor = (orderIds: readonly string[]) => orderIds.map((orderId, index) => ({ sequence: index + 1, orderId }));
/** Location every order created through `validOrderBody` has; its stop must copy it. */
const ORDER_LOCATION = { addressLine: 'Av. Javier Prado Este 1234', latitude: -12.0975, longitude: -77.0023 };

describe('GET /api/v1/delivery-routes', () => {
  it('lists only the authenticated organization routes for dispatch roles', async () => {
    const ctx = await seededRouteApp();
    const orderId = await ctx.createOrder('LIST-ROUTE-ORDER');
    const created = await request(ctx.testApp.app).post(ROUTES).set(bearer(ctx.token)).send({
      publicCode: 'LIST-ROUTE-001', plannedDate: '2026-11-02',
      driverId: ctx.driverId, vehicleId: ctx.vehicleId,
      stops: [{ sequence: 1, orderId: orderId }],
    });
    expect(created.status).toBe(201);

    const response = await request(ctx.testApp.app).get(ROUTES).set(bearer(ctx.token));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([created.body.data]);
    expect((await request(ctx.testApp.app).get(ROUTES).set(bearer(ctx.otherToken))).body.data).toEqual([]);
  });

  it('keeps route listing and route detail restricted to dispatch roles', async () => {
    const ctx = await seededRouteApp();
    const orderId = await ctx.createOrder('LIST-ROLE-ORDER');
    const created = await request(ctx.testApp.app).post(ROUTES).set(bearer(ctx.token)).send({
      publicCode: 'LIST-ROLE-001', plannedDate: '2026-11-02',
      driverId: ctx.driverId, vehicleId: ctx.vehicleId,
      stops: [{ sequence: 1, orderId: orderId }],
    });
    const driver = await ctx.testApp.seedUser({ id: DRIVER_ID, email: DRIVER_EMAIL, role: 'DRIVER' });
    const driverToken = await ctx.testApp.signIn(driver);

    expect((await request(ctx.testApp.app).get(ROUTES).set(bearer(driverToken))).status).toBe(403);
    expect((await request(ctx.testApp.app).get(`${ROUTES}/${created.body.data.id}`)
      .set(bearer(driverToken))).status).toBe(403);
  });
});

async function seededRouteApp() {
  const testApp = buildTestApp({ seedTestCustomer: true });
  await testApp.seedOrganization();
  await testApp.seedOrganization({ id: OTHER_ORGANIZATION_ID, name: 'Callao Express' });
  const admin = await testApp.seedUser();
  const otherAdmin = await testApp.seedUser({
    id: '44444444-4444-4444-8444-444444444441',
    organizationId: OTHER_ORGANIZATION_ID,
    email: 'other-admin@callao.test',
  });
  const token = await testApp.signIn(admin);
  const otherToken = await testApp.signIn(otherAdmin);
  const driver = await request(testApp.app).post('/api/v1/drivers').set(bearer(token))
    .send({ fullName: 'Luis Quispe', documentNumber: 'DNI-12345678',
      phone: '+51 911 222 333', licenseNumber: 'Q-987654' });
  const vehicle = await request(testApp.app).post('/api/v1/vehicles').set(bearer(token))
    .send({ plate: 'ABC-123', type: 'van', capacityKg: 800 });
  const secondDriver = await request(testApp.app).post('/api/v1/drivers').set(bearer(token))
    .send({ fullName: 'Rosa Medina', documentNumber: 'DNI-87654321',
      phone: '+51 911 222 334', licenseNumber: 'Q-876543' });
  const secondVehicle = await request(testApp.app).post('/api/v1/vehicles').set(bearer(token))
    .send({ plate: 'DEF-456', type: 'van', capacityKg: 700 });
  expect(driver.status).toBe(201);
  expect(vehicle.status).toBe(201);
  expect(secondDriver.status).toBe(201);
  expect(secondVehicle.status).toBe(201);
  const createOrder = async (publicCode: string) => {
    const result = await request(testApp.app).post(ORDERS).set(bearer(token))
      .send(validOrderBody({ publicCode }));
    expect(result.status).toBe(201);
    return result.body.data.id as string;
  };
  return { testApp, token, otherToken, driverId: driver.body.data.id as string,
    vehicleId: vehicle.body.data.id as string,
    secondDriverId: secondDriver.body.data.id as string,
    secondVehicleId: secondVehicle.body.data.id as string,
    createOrder };
}

describe('driver route execution', () => {
  it('shows only the bound driver their route, one stop per order, and starts all orders once', async () => {
    const ctx = await seededRouteApp();
    const user = await ctx.testApp.seedUser({ id: DRIVER_ID, email: DRIVER_EMAIL, role: 'DRIVER' });
    const driverToken = await ctx.testApp.signIn(user);
    const other = await ctx.testApp.seedUser({ id: '44444444-4444-4444-8444-444444444447',
      email: 'second-driver@example.test', role: 'DRIVER' });
    const otherToken = await ctx.testApp.signIn(other);
    const ids = await Promise.all(['D-ROUTE-1', 'D-ROUTE-2'].map(ctx.createOrder));
    const planned = await request(ctx.testApp.app).post(ROUTES).set(bearer(ctx.token)).send({
      publicCode: 'EXEC-ROUTE-1', plannedDate: '2026-10-27',
      driverId: ctx.driverId, vehicleId: ctx.vehicleId,
      stops: stopsFor(ids),
    });
    expect(planned.status).toBe(201);
    const mine = `${ROUTES}/mine`;
    expect((await request(ctx.testApp.app).get(mine).set(bearer(otherToken))).status).toBe(404);
    expect((await request(ctx.testApp.app).get(mine).set(bearer(ctx.token))).status).toBe(403);
    expect((await request(ctx.testApp.app).get(mine)).status).toBe(401);
    expect((await request(ctx.testApp.app).get(mine).set(bearer(driverToken))).status).toBe(404);
    const bound = await request(ctx.testApp.app).put(`/api/v1/drivers/${ctx.driverId}/account`)
      .set(bearer(ctx.token)).send({ userId: DRIVER_ID });
    expect(bound.status).toBe(200);
    const read = await request(ctx.testApp.app).get(mine).set(bearer(driverToken));
    expect(read.status).toBe(200);
    expect(read.body.data).toMatchObject({ id: planned.body.data.id, status: 'planned',
      stops: ids.map((id, index) => ({ sequence: index + 1, orders: [{ id, status: 'assigned' }] })) });
    const before = await Promise.all(ids.map(async (id) =>
      (await request(ctx.testApp.app).get(`${ORDERS}/${id}/history`).set(bearer(ctx.token))).body));
    const start = `${ROUTES}/${planned.body.data.id as string}/start`;
    expect((await request(ctx.testApp.app).post(start).set(bearer(otherToken)).send({})).status).toBe(404);
    expect((await request(ctx.testApp.app).post(start).set(bearer(ctx.token)).send({})).status).toBe(403);
    expect((await request(ctx.testApp.app).post(start).set(bearer(driverToken))
      .send({ driverId: ctx.driverId })).status).toBe(400);
    const started = await request(ctx.testApp.app).post(start).set(bearer(driverToken)).send({});
    expect(started.status).toBe(200);
    expect(started.body.data).toMatchObject({ id: planned.body.data.id, status: 'in_progress',
      stops: ids.map((id) => ({ orders: [{ id, status: 'in_transit' }] })) });
    expect(started.body.data.startedAt).toEqual(expect.any(String));
    expect((await request(ctx.testApp.app).get(mine).set(bearer(driverToken))).body).toEqual(started.body);
    for (const [index, id] of ids.entries()) {
      const order = await request(ctx.testApp.app).get(`${ORDERS}/${id}`).set(bearer(ctx.token));
      expect(order.body.data).toMatchObject({ id, status: 'in_transit' });
      const history = await request(ctx.testApp.app).get(`${ORDERS}/${id}/history`).set(bearer(ctx.token));
      expect(history.body.data.slice(0, before[index].data.length)).toEqual(before[index].data);
      expect(history.body.data.at(-1)).toMatchObject({ fromStatus: 'assigned',
        toStatus: 'in_transit', actorUserId: DRIVER_ID });
    }
    expect((await request(ctx.testApp.app).post(start).set(bearer(driverToken)).send({})).status).toBe(409);
    expect((await request(ctx.testApp.app).patch(`${ROUTES}/${planned.body.data.id as string}`)
      .set(bearer(ctx.token)).send({ driverId: ctx.secondDriverId })).status).toBe(409);
  });
});

describe('POST /api/v1/delivery-routes', () => {
  it('redispatches the same returned order without replacing its prior history', async () => {
    const ctx = await seededRouteApp();
    const id = await ctx.createOrder('RETRY-ORDER-1');
    const first = await request(ctx.testApp.app).post(ROUTES).set(bearer(ctx.token)).send({
      publicCode: 'RETRY-ROUTE-1', plannedDate: '2026-10-27',
      driverId: ctx.driverId, vehicleId: ctx.vehicleId,
      stops: [{ sequence: 1, orderId: id }],
    });
    expect(first.status).toBe(201);
    // Phase 4 is not implemented: seed its returned outcome, then use the real HTTP planner.
    const repository = ctx.testApp.module.repository as unknown as {
      orders: Map<string, DeliveryOrder>;
      statusHistory: Map<string, { fromStatus: string; toStatus: string; actorUserId: string; occurredAt: string }[]>;
    };
    const original = repository.orders.get(id);
    expect(original).toBeDefined();
    repository.orders.set(id, DeliveryOrder.restore({
      id, organizationId: ORGANIZATION_ID, customerId: original!.customerId, publicCode: original!.publicCode, timeWindow: original!.timeWindow,
      recipient: original!.recipient, deliveryAddress: original!.deliveryAddress,
      packages: original!.packages, createdAt: original!.createdAt,
      activeRouteId: first.body.data.id as string,
      status: 'returned', updatedAt: '2026-10-26T15:00:00.002Z',
    }));
    repository.statusHistory.get(id)?.push({
      fromStatus: 'assigned', toStatus: 'returned', actorUserId: ADMIN_ID,
      occurredAt: '2026-10-26T15:00:00.002Z',
    });
    const prior = await request(ctx.testApp.app).get(`${ORDERS}/${id}/history`).set(bearer(ctx.token));
    const secondBody = {
      publicCode: 'RETRY-ROUTE-2', plannedDate: '2026-10-27',
      driverId: ctx.secondDriverId, vehicleId: ctx.secondVehicleId,
      stops: [{ sequence: 1, orderId: id }],
    };
    const denied = await request(ctx.testApp.app).post(ROUTES).set(bearer(ctx.otherToken)).send(secondBody);
    expect(denied.status).toBe(404);
    const retry = await request(ctx.testApp.app).post(ROUTES).set(bearer(ctx.token)).send(secondBody);
    expect(retry.status).toBe(201);
    expect((await request(ctx.testApp.app).get(`${ORDERS}/${id}`).set(bearer(ctx.token))).body.data)
      .toMatchObject({ id, status: 'assigned' });
    const history = await request(ctx.testApp.app).get(`${ORDERS}/${id}/history`).set(bearer(ctx.token));
    expect(history.status).toBe(200);
    expect(history.body.data.slice(0, prior.body.data.length)).toEqual(prior.body.data);
    expect(history.body.data.slice(prior.body.data.length).map(
      (entry: { fromStatus: string; toStatus: string }) => [entry.fromStatus, entry.toStatus],
    )).toEqual([['returned', 'planned'], ['planned', 'assigned']]);
    expect(Date.parse(history.body.data.at(-2).occurredAt)).toBeGreaterThan(
      Date.parse(prior.body.data.at(-1).occurredAt));
    expect((await request(ctx.testApp.app).get(first.headers.location as string)
      .set(bearer(ctx.token))).status).toBe(200);
    const rejected = await request(ctx.testApp.app).post(ROUTES).set(bearer(ctx.token))
      .send({ ...secondBody, publicCode: 'RETRY-ROUTE-3' });
    expect(rejected.status).toBe(409);
    expect((await request(ctx.testApp.app).get(`${ORDERS}/${id}/history`)
      .set(bearer(ctx.token))).body).toEqual(history.body);
  });

  it('round-trips stops by sequence, each one inheriting its order location', async () => {
    const { testApp, token, driverId, vehicleId, createOrder } = await seededRouteApp();
    const first = await createOrder('REG-ROUTE-001');
    const second = await createOrder('REG-ROUTE-002');
    const third = await createOrder('REG-ROUTE-003');
    const created = await request(testApp.app).post(ROUTES).set(bearer(token)).send({
      publicCode: 'REG-ROUTE-001', plannedDate: '2026-10-27', driverId, vehicleId,
      stops: [
        { sequence: 3, orderId: third },
        { sequence: 1, orderId: first },
        { sequence: 2, orderId: second },
      ],
    });
    expect(created.status).toBe(201);
    const read = await request(testApp.app).get(created.headers.location as string).set(bearer(token));
    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body);
    expect(read.body.data.stops).toEqual([first, second, third].map((orderId, index) => ({
      id: expect.any(String), sequence: index + 1, ...ORDER_LOCATION, orderIds: [orderId],
    })));
  });

  it('rejects stops that carry their own location or group several orders', async () => {
    const { testApp, token, driverId, vehicleId, createOrder } = await seededRouteApp();
    const first = await createOrder('ORD-LEGACY-001');
    const second = await createOrder('ORD-LEGACY-002');
    const base = { publicCode: 'LEGACY-ROUTE-001', plannedDate: '2026-10-27', driverId, vehicleId };
    for (const stop of [
      { sequence: 1, addressLine: 'Av. Arequipa 1234', orderIds: [first, second] },
      { sequence: 1, orderId: first, addressLine: 'Av. Arequipa 1234' },
      { sequence: 1, orderId: first, googleMapsUrl: 'https://maps.app.goo.gl/place' },
      { sequence: 1, orderId: first, latitude: -12.1, longitude: -77.03 },
    ]) {
      const response = await request(testApp.app).post(ROUTES).set(bearer(token)).send({ ...base, stops: [stop] });
      expect(response.status).toBe(400);
    }
    for (const id of [first, second]) {
      expect((await request(testApp.app).get(`${ORDERS}/${id}`).set(bearer(token))).body.data.status).toBe('created');
    }
  });

  it('plans one ordered stop per order and audits each assignment', async () => {
    const { testApp, token, otherToken, driverId, vehicleId, createOrder } = await seededRouteApp();
    const first = await createOrder('ORD-ROUTE-001');
    const second = await createOrder('ORD-ROUTE-002');
    const third = await createOrder('ORD-ROUTE-003');
    const result = await request(testApp.app).post(ROUTES).set(bearer(token)).send({
      publicCode: 'LIMA-ROUTE-001', plannedDate: '2026-10-27', driverId, vehicleId,
      stops: stopsFor([first, second, third]),
    });
    expect(result.status).toBe(201);
    expect(result.body.data).toMatchObject({
      organizationId: ORGANIZATION_ID, publicCode: 'LIMA-ROUTE-001',
      plannedDate: '2026-10-27', status: 'planned', driverId, vehicleId,
      stops: [
        { sequence: 1, ...ORDER_LOCATION, orderIds: [first] },
        { sequence: 2, ...ORDER_LOCATION, orderIds: [second] },
        { sequence: 3, ...ORDER_LOCATION, orderIds: [third] },
      ],
    });
    const read = await request(testApp.app).get(result.headers.location as string).set(bearer(token));
    expect(read.status).toBe(200);
    expect(read.body).toEqual(result.body);
    const foreignRead = await request(testApp.app).get(result.headers.location as string)
      .set(bearer(otherToken));
    expect(foreignRead.status).toBe(404);
    expect((await request(testApp.app).get(result.headers.location as string)).status).toBe(401);
    for (const id of [first, second, third]) {
      const order = await request(testApp.app).get(`${ORDERS}/${id}`).set(bearer(token));
      const history = await request(testApp.app).get(`${ORDERS}/${id}/history`).set(bearer(token));
      expect(order.status).toBe(200);
      expect(order.body.data.status).toBe('assigned');
      const rejectedEdit = await request(testApp.app).patch(`${ORDERS}/${id}`).set(bearer(token))
        .send({ recipient: { name: 'Too Late', phone: '+51 987 654 321' } });
      expect(rejectedEdit.status).toBe(409);
      expect(history.status).toBe(200);
      expect(history.body.data.map((entry: { fromStatus: string; toStatus: string; actorUserId: string }) =>
        [entry.fromStatus, entry.toStatus, entry.actorUserId])).toEqual([
        ['created', 'planned', ADMIN_ID], ['planned', 'assigned', ADMIN_ID],
      ]);
    }
  });

  it('rejects foreign and duplicate orders without changing their state', async () => {
    const { testApp, token, otherToken, driverId, vehicleId, createOrder } = await seededRouteApp();
    const first = await createOrder('ORD-ROUTE-004');
    const beforeOrder = await request(testApp.app).get(`${ORDERS}/${first}`).set(bearer(token));
    const beforeHistory = await request(testApp.app).get(`${ORDERS}/${first}/history`).set(bearer(token));
    const requestBody = (orderIds: string[]) => ({
      publicCode: 'LIMA-ROUTE-002', plannedDate: '2026-10-27', driverId, vehicleId,
      stops: stopsFor(orderIds),
    });
    const foreignOrder = await request(testApp.app).post(ORDERS).set(bearer(otherToken))
      .send(validOrderBody({ customerId: OTHER_CUSTOMER_ID, publicCode: 'FOREIGN-ROUTE-1' }));
    expect(foreignOrder.status).toBe(201);
    const foreign = await request(testApp.app).post(ROUTES).set(bearer(token))
      .send(requestBody([foreignOrder.body.data.id as string]));
    expect(foreign.status).toBe(404);
    const duplicate = await request(testApp.app).post(ROUTES).set(bearer(token))
      .send(requestBody([first, first]));
    expect(duplicate.status).toBe(400);
    const order = await request(testApp.app).get(`${ORDERS}/${first}`).set(bearer(token));
    const history = await request(testApp.app).get(`${ORDERS}/${first}/history`).set(bearer(token));
    expect(order.body).toEqual(beforeOrder.body);
    expect(history.body).toEqual(beforeHistory.body);
    expect(order.body.data.status).toBe('created');
    expect(history.body).toEqual({ data: [] });
  });

  it('rejects foreign resources, DRIVER writes and missing authentication without writes', async () => {
    const { testApp, token, otherToken, driverId, vehicleId, createOrder } = await seededRouteApp();
    const id = await createOrder('ROUTE-GUARD-1');
    const before = await request(testApp.app).get(`${ORDERS}/${id}`).set(bearer(token));
    const beforeHistory = await request(testApp.app).get(`${ORDERS}/${id}/history`).set(bearer(token));
    const otherDriver = await request(testApp.app).post('/api/v1/drivers')
      .set(bearer(otherToken)).send({ fullName: 'Other Driver', documentNumber: 'DNI-87654321',
        phone: '+51 911 222 333', licenseNumber: 'Q-876543' });
    const otherVehicle = await request(testApp.app).post('/api/v1/vehicles')
      .set(bearer(otherToken)).send({ plate: 'DEF-456', type: 'van', capacityKg: 800 });
    expect(otherDriver.status).toBe(201);
    expect(otherVehicle.status).toBe(201);
    const body = { publicCode: 'ROUTE-GUARD-1', plannedDate: '2026-10-27', driverId,
      vehicleId, stops: [{ sequence: 1, orderId: id }] };
    for (const foreign of [
      { driverId: otherDriver.body.data.id as string },
      { vehicleId: otherVehicle.body.data.id as string },
    ]) {
      const denied = await request(testApp.app).post(ROUTES).set(bearer(token))
        .send({ ...body, ...foreign });
      expect(denied.status).toBe(404);
    }
    const user = await testApp.seedUser({ id: DRIVER_ID, email: DRIVER_EMAIL, role: 'DRIVER' });
    const driverToken = await testApp.signIn(user);
    expect((await request(testApp.app).post(ROUTES).set(bearer(driverToken)).send(body)).status).toBe(403);
    expect((await request(testApp.app).post(ROUTES).send(body)).status).toBe(401);
    expect((await request(testApp.app).get(`${ORDERS}/${id}`).set(bearer(token))).body)
      .toEqual(before.body);
    expect((await request(testApp.app).get(`${ORDERS}/${id}/history`).set(bearer(token))).body)
      .toEqual(beforeHistory.body);
  });
});

describe('GET /api/v1/delivery-routes/simulation', () => {
  it('reports simulation as unavailable outside development and restricts it to dispatch roles', async () => {
    const { testApp, token } = await seededRouteApp();

    const response = await request(testApp.app).get(`${ROUTES}/simulation`).set(bearer(token));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { enabled: false, eligibleDriverIds: [] } });
    const user = await testApp.seedUser({ id: DRIVER_ID, email: DRIVER_EMAIL, role: 'DRIVER' });
    const driverToken = await testApp.signIn(user);
    expect((await request(testApp.app).get(`${ROUTES}/simulation`).set(bearer(driverToken))).status).toBe(403);
    expect((await request(testApp.app).get(`${ROUTES}/simulation`)).status).toBe(401);
  });
});

describe('POST /api/v1/delivery-routes simulation outside development', () => {
  it('rejects a simulated route with 400 and leaves the order unchanged', async () => {
    const { testApp, token, driverId, vehicleId, createOrder } = await seededRouteApp();
    const id = await createOrder('ROUTE-SIM-OFF-1');
    const before = await request(testApp.app).get(`${ORDERS}/${id}`).set(bearer(token));

    const response = await request(testApp.app).post(ROUTES).set(bearer(token)).send({
      publicCode: 'ROUTE-SIM-OFF-1', plannedDate: '2026-10-27', driverId, vehicleId,
      simulatedCompletionEnabled: true,
      origin: { addressLine: 'Núcleo de investigación', latitude: -11.97, longitude: -77.08 },
      stops: [{ sequence: 1, orderId: id }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'DELIVERY_ROUTE_INVALID_INPUT',
      message: 'Route simulation is only available in development' });
    expect((await request(testApp.app).get(`${ORDERS}/${id}`).set(bearer(token))).body)
      .toEqual(before.body);
  });
});

describe('PATCH /api/v1/delivery-routes/:routeId', () => {
  async function planRoute(
    ctx: Awaited<ReturnType<typeof seededRouteApp>>,
    publicCode: string, orderIds: string[],
    resources: { driverId: string; vehicleId: string } = {
      driverId: ctx.driverId, vehicleId: ctx.vehicleId },
  ) {
    const result = await request(ctx.testApp.app).post(ROUTES).set(bearer(ctx.token)).send({
      publicCode, plannedDate: '2026-10-27', ...resources,
      stops: stopsFor(orderIds),
    });
    expect(result.status).toBe(201);
    return result.body.data as { id: string; driverId: string; vehicleId: string; stops: unknown };
  }

  it('reassigns driver and vehicle without changing assigned orders or their history', async () => {
    const ctx = await seededRouteApp();
    const first = await ctx.createOrder('REASSIGN-001');
    const second = await ctx.createOrder('REASSIGN-002');
    const route = await planRoute(ctx, 'REASSIGN-ROUTE', [first, second]);
    const orderSnapshots = await Promise.all([first, second].map(async (id) => ({
      order: (await request(ctx.testApp.app).get(`${ORDERS}/${id}`).set(bearer(ctx.token))).body,
      history: (await request(ctx.testApp.app).get(`${ORDERS}/${id}/history`).set(bearer(ctx.token))).body,
    })));
    const changed = await request(ctx.testApp.app).patch(`${ROUTES}/${route.id}`)
      .set(bearer(ctx.token)).send({ driverId: ctx.secondDriverId, vehicleId: ctx.secondVehicleId });
    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({ id: route.id, driverId: ctx.secondDriverId,
      vehicleId: ctx.secondVehicleId, status: 'planned', stops: route.stops });
    const read = await request(ctx.testApp.app).get(`${ROUTES}/${route.id}`).set(bearer(ctx.token));
    expect(read.body).toEqual(changed.body);
    for (const [index, id] of [first, second].entries()) {
      const order = await request(ctx.testApp.app).get(`${ORDERS}/${id}`).set(bearer(ctx.token));
      const history = await request(ctx.testApp.app).get(`${ORDERS}/${id}/history`).set(bearer(ctx.token));
      expect(order.body).toEqual(orderSnapshots[index]?.order);
      expect(history.body).toEqual(orderSnapshots[index]?.history);
      expect(order.body.data.status).toBe('assigned');
    }
  });

  it('reassigns only the supplied resource and keeps the other one', async () => {
    const ctx = await seededRouteApp();
    const id = await ctx.createOrder('REASSIGN-PARTIAL');
    const route = await planRoute(ctx, 'REASSIGN-PARTIAL', [id]);
    const changed = await request(ctx.testApp.app).patch(`${ROUTES}/${route.id}`)
      .set(bearer(ctx.token)).send({ driverId: ctx.secondDriverId });
    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({ id: route.id, driverId: ctx.secondDriverId,
      vehicleId: ctx.vehicleId });
  });

  it('rejects invalid, foreign or busy resources without changing the route', async () => {
    const ctx = await seededRouteApp();
    const first = await ctx.createOrder('REASSIGN-GUARD-1');
    const second = await ctx.createOrder('REASSIGN-GUARD-2');
    const route = await planRoute(ctx, 'REASSIGN-GUARD-1', [first]);
    const otherRoute = await planRoute(ctx, 'REASSIGN-GUARD-2', [second], {
      driverId: ctx.secondDriverId, vehicleId: ctx.secondVehicleId,
    });
    const before = await request(ctx.testApp.app).get(`${ROUTES}/${route.id}`).set(bearer(ctx.token));
    const path = `${ROUTES}/${route.id}`;
    expect((await request(ctx.testApp.app).patch(path).set(bearer(ctx.token)).send({})).status).toBe(400);
    expect((await request(ctx.testApp.app).patch(path).set(bearer(ctx.token))
      .send({ unknown: 'x' })).status).toBe(400);
    expect((await request(ctx.testApp.app).patch(path).set(bearer(ctx.otherToken))
      .send({ driverId: ctx.secondDriverId })).status).toBe(404);
    expect((await request(ctx.testApp.app).patch(path).set(bearer(ctx.token))
      .send({ driverId: ctx.secondDriverId })).status).toBe(409);
    const foreignDriver = await request(ctx.testApp.app).post('/api/v1/drivers')
      .set(bearer(ctx.otherToken)).send({ fullName: 'Foreign Driver', documentNumber: 'DNI-11112222',
        phone: '+51 911 222 333', licenseNumber: 'Q-111222' });
    expect(foreignDriver.status).toBe(201);
    expect((await request(ctx.testApp.app).patch(path).set(bearer(ctx.token))
      .send({ driverId: foreignDriver.body.data.id as string })).status).toBe(404);
    const inactive = await request(ctx.testApp.app).post('/api/v1/drivers')
      .set(bearer(ctx.token)).send({ fullName: 'Inactive Driver', documentNumber: 'DNI-33334444',
        phone: '+51 911 222 333', licenseNumber: 'Q-333444' });
    expect(inactive.status).toBe(201);
    const deactivated = await request(ctx.testApp.app)
      .patch(`/api/v1/drivers/${inactive.body.data.id as string}`).set(bearer(ctx.token))
      .send({ status: 'inactive' });
    expect(deactivated.status).toBe(200);
    expect((await request(ctx.testApp.app).patch(path).set(bearer(ctx.token))
      .send({ driverId: inactive.body.data.id as string })).status).toBe(409);
    const driverUser = await ctx.testApp.seedUser({ id: DRIVER_ID, email: DRIVER_EMAIL, role: 'DRIVER' });
    const driverToken = await ctx.testApp.signIn(driverUser);
    expect((await request(ctx.testApp.app).patch(path).set(bearer(driverToken))
      .send({ driverId: ctx.secondDriverId })).status).toBe(403);
    expect((await request(ctx.testApp.app).patch(path)
      .send({ driverId: ctx.secondDriverId })).status).toBe(401);
    expect((await request(ctx.testApp.app).get(path).set(bearer(ctx.token))).body).toEqual(before.body);
    expect((await request(ctx.testApp.app).get(`${ROUTES}/${otherRoute.id}`).set(bearer(ctx.token))).body.data.driverId)
      .toBe(ctx.secondDriverId);
  });
});
