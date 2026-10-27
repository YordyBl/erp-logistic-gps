import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_ID, bearer, buildTestApp, DRIVER_EMAIL, DRIVER_ID,
  ORGANIZATION_ID, OTHER_ORGANIZATION_ID, validOrderBody,
} from './support/test-app.js';

const ROUTES = '/api/v1/delivery-routes';
const ORDERS = '/api/v1/delivery-orders';

async function seededRouteApp() {
  const testApp = buildTestApp();
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

describe('POST /api/v1/delivery-routes', () => {
  it('round-trips stops by sequence and keeps the order of orders within a stop', async () => {
    const { testApp, token, driverId, vehicleId, createOrder } = await seededRouteApp();
    const first = await createOrder('REG-ROUTE-001');
    const second = await createOrder('REG-ROUTE-002');
    const third = await createOrder('REG-ROUTE-003');
    const created = await request(testApp.app).post(ROUTES).set(bearer(token)).send({
      publicCode: 'REG-ROUTE-001', plannedDate: '2026-10-27', driverId, vehicleId,
      stops: [
        { sequence: 2, addressLine: 'Av. Salaverry 456', orderIds: [third] },
        { sequence: 1, addressLine: 'Av. Arequipa 1234', orderIds: [first, second] },
      ],
    });
    expect(created.status).toBe(201);
    const read = await request(testApp.app).get(created.headers.location as string).set(bearer(token));
    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body);
    expect(read.body.data.stops.map((stop: { sequence: number; orderIds: string[] }) =>
      [stop.sequence, stop.orderIds])).toEqual([[1, [first, second]], [2, [third]]]);
  });

  it('plans ordered stops with multiple orders and audits each assignment', async () => {
    const { testApp, token, otherToken, driverId, vehicleId, createOrder } = await seededRouteApp();
    const first = await createOrder('ORD-ROUTE-001');
    const second = await createOrder('ORD-ROUTE-002');
    const third = await createOrder('ORD-ROUTE-003');
    const result = await request(testApp.app).post(ROUTES).set(bearer(token)).send({
      publicCode: 'LIMA-ROUTE-001', plannedDate: '2026-10-27', driverId, vehicleId,
      stops: [
        { sequence: 1, addressLine: 'Av. Arequipa 1234', latitude: -12.1,
          longitude: -77.03, orderIds: [first, second] },
        { sequence: 2, addressLine: 'Av. Salaverry 456', latitude: -12.09,
          longitude: -77.04, orderIds: [third] },
      ],
    });
    expect(result.status).toBe(201);
    expect(result.body.data).toMatchObject({
      organizationId: ORGANIZATION_ID, publicCode: 'LIMA-ROUTE-001',
      plannedDate: '2026-10-27', status: 'planned', driverId, vehicleId,
      stops: [
        { sequence: 1, orderIds: [first, second] },
        { sequence: 2, orderIds: [third] },
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
      stops: [{ sequence: 1, addressLine: 'Av. Arequipa 1234', orderIds }],
    });
    const foreignOrder = await request(testApp.app).post(ORDERS).set(bearer(otherToken))
      .send(validOrderBody({ publicCode: 'FOREIGN-ROUTE-1' }));
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
      vehicleId, stops: [{ sequence: 1, addressLine: 'Av. Arequipa 1234', orderIds: [id] }] };
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

describe('PATCH /api/v1/delivery-routes/:routeId', () => {
  async function planRoute(
    ctx: Awaited<ReturnType<typeof seededRouteApp>>,
    publicCode: string, orderIds: string[],
    resources: { driverId: string; vehicleId: string } = {
      driverId: ctx.driverId, vehicleId: ctx.vehicleId },
  ) {
    const result = await request(ctx.testApp.app).post(ROUTES).set(bearer(ctx.token)).send({
      publicCode, plannedDate: '2026-10-27', ...resources,
      stops: [{ sequence: 1, addressLine: 'Av. Arequipa 1234', orderIds }],
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
