import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { bearer, buildTestApp, OTHER_CUSTOMER_ID, OTHER_ORGANIZATION_ID, validOrderBody } from './support/test-app.js';

const ROUTES = '/api/v1/delivery-routes';
const ORDERS = '/api/v1/delivery-orders';

async function setup() {
  const testApp = buildTestApp({ seedTestCustomer: true });
  await testApp.seedOrganization();
  await testApp.seedOrganization({ id: OTHER_ORGANIZATION_ID, name: 'Callao Express' });
  const admin = await testApp.seedUser();
  const otherAdmin = await testApp.seedUser({
    id: '44444444-4444-4444-8444-444444444441', organizationId: OTHER_ORGANIZATION_ID,
    email: 'other-admin@callao.test' });
  const token = await testApp.signIn(admin);
  const otherToken = await testApp.signIn(otherAdmin);
  const createDriver = async (suffix: string) => {
    const created = await request(testApp.app).post('/api/v1/drivers').set(bearer(token))
      .send({ fullName: `Driver ${suffix}`, documentNumber: `DNI-1000${suffix}`,
        phone: '+51 911 222 333', licenseNumber: `L-1000${suffix}` });
    expect(created.status).toBe(201);
    return created.body.data.id as string;
  };
  const createVehicle = async (suffix: string) => {
    const created = await request(testApp.app).post('/api/v1/vehicles').set(bearer(token))
      .send({ plate: `RSG-${suffix}`, type: 'van', capacityKg: 800 });
    expect(created.status).toBe(201);
    return created.body.data.id as string;
  };
  const createOrder = async (publicCode: string) => {
    const created = await request(testApp.app).post(ORDERS).set(bearer(token))
      .send(validOrderBody({ publicCode }));
    expect(created.status).toBe(201);
    return created.body.data.id as string;
  };
  const planRoute = async (publicCode: string, driverId: string, vehicleId: string,
    orderIds: string[]) => {
    const created = await request(testApp.app).post(ROUTES).set(bearer(token)).send({
      publicCode, plannedDate: '2026-10-27', driverId, vehicleId,
      stops: orderIds.map((orderId, index) => ({ sequence: index + 1, orderId })) });
    expect(created.status).toBe(201);
    return created.body.data as { id: string; driverId: string; vehicleId: string };
  };
  return { testApp, token, otherToken, createDriver, createVehicle, createOrder, planRoute };
}

describe('PATCH /api/v1/delivery-routes/:routeId (regression probes)', () => {
  it('rolls back the driver half when the vehicle half is already assigned', async () => {
    const ctx = await setup();
    const firstDriver = await ctx.createDriver('01');
    const secondDriver = await ctx.createDriver('02');
    const spareDriver = await ctx.createDriver('03');
    const firstVehicle = await ctx.createVehicle('01');
    const secondVehicle = await ctx.createVehicle('02');
    const id = await ctx.createOrder('RSG-ROLLBACK-1');
    const route = await ctx.planRoute('RSG-ROLLBACK', firstDriver, firstVehicle, [id]);
    await ctx.planRoute('RSG-ROLLBACK-BUSY', secondDriver, secondVehicle,
      [await ctx.createOrder('RSG-ROLLBACK-2')]);
    const before = await request(ctx.testApp.app).get(`${ROUTES}/${route.id}`).set(bearer(ctx.token));
    const rejected = await request(ctx.testApp.app).patch(`${ROUTES}/${route.id}`)
      .set(bearer(ctx.token)).send({ driverId: spareDriver, vehicleId: secondVehicle });
    expect(rejected.status).toBe(409);
    const after = await request(ctx.testApp.app).get(`${ROUTES}/${route.id}`).set(bearer(ctx.token));
    expect(after.body).toEqual(before.body);
    expect(after.body.data).toMatchObject({ driverId: firstDriver, vehicleId: firstVehicle });
  });

  it('rejects tenant, status and identity injection through the body', async () => {
    const ctx = await setup();
    const driverId = await ctx.createDriver('04');
    const spareDriver = await ctx.createDriver('05');
    const vehicleId = await ctx.createVehicle('03');
    const route = await ctx.planRoute('RSG-INJECT', driverId, vehicleId,
      [await ctx.createOrder('RSG-INJECT-1')]);
    const before = await request(ctx.testApp.app).get(`${ROUTES}/${route.id}`).set(bearer(ctx.token));
    for (const body of [
      { driverId: spareDriver, organizationId: OTHER_ORGANIZATION_ID },
      { driverId: spareDriver, status: 'completed' },
      { driverId: spareDriver, routeId: OTHER_ORGANIZATION_ID },
    ]) {
      const rejected = await request(ctx.testApp.app).patch(`${ROUTES}/${route.id}`)
        .set(bearer(ctx.token)).send(body);
      expect(rejected.status).toBe(400);
    }
    const after = await request(ctx.testApp.app).get(`${ROUTES}/${route.id}`).set(bearer(ctx.token));
    expect(after.body).toEqual(before.body);
  });

  it('does not reassign a route from another organization', async () => {
    const ctx = await setup();
    const foreignDriver = await request(ctx.testApp.app).post('/api/v1/drivers')
      .set(bearer(ctx.otherToken)).send({ fullName: 'Callao Driver',
        documentNumber: 'DNI-90000001', phone: '+51 911 222 333', licenseNumber: 'L-90000001' });
    expect(foreignDriver.status).toBe(201);
    const foreignVehicle = await request(ctx.testApp.app).post('/api/v1/vehicles')
      .set(bearer(ctx.otherToken)).send({ plate: 'CLL-001', type: 'van', capacityKg: 800 });
    expect(foreignVehicle.status).toBe(201);
    const foreignOrder = await request(ctx.testApp.app).post(ORDERS)
      .set(bearer(ctx.otherToken)).send(validOrderBody({ customerId: OTHER_CUSTOMER_ID, publicCode: 'CLL-ORDER-1' }));
    expect(foreignOrder.status).toBe(201);
    const foreignRoute = await request(ctx.testApp.app).post(ROUTES).set(bearer(ctx.otherToken)).send({
      publicCode: 'CLL-ROUTE', plannedDate: '2026-10-27',
      driverId: foreignDriver.body.data.id, vehicleId: foreignVehicle.body.data.id,
      stops: [{ sequence: 1, orderId: foreignOrder.body.data.id }] });
    expect(foreignRoute.status).toBe(201);
    const ownDriver = await ctx.createDriver('06');
    const rejected = await request(ctx.testApp.app)
      .patch(`${ROUTES}/${foreignRoute.body.data.id as string}`)
      .set(bearer(ctx.token)).send({ driverId: ownDriver });
    expect(rejected.status).toBe(404);
    const untouched = await request(ctx.testApp.app)
      .get(`${ROUTES}/${foreignRoute.body.data.id as string}`).set(bearer(ctx.otherToken));
    expect(untouched.body.data.driverId).toBe(foreignDriver.body.data.id);
  });
});
