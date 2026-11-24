import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_ID,
  DISPATCHER_EMAIL,
  DISPATCHER_ID,
  DRIVER_EMAIL,
  DRIVER_ID,
  ORGANIZATION_ID,
  OTHER_ADMIN_EMAIL,
  OTHER_ADMIN_ID,
  OTHER_ORGANIZATION_ID,
  TEST_PASSWORD,
  bearer,
  buildTestApp,
} from './support/test-app.js';

const USERS_PATH = '/api/v1/users';
const LOGIN_PATH = '/api/v1/auth/login';

async function seedTeam() {
  const testApp = buildTestApp();
  await testApp.seedOrganization();
  await testApp.seedOrganization({ id: OTHER_ORGANIZATION_ID, name: 'Callao Cargo' });
  const admin = await testApp.seedUser();
  const dispatcher = await testApp.seedUser({ id: DISPATCHER_ID, email: DISPATCHER_EMAIL, role: 'DISPATCHER' });
  const driver = await testApp.seedUser({ id: DRIVER_ID, email: DRIVER_EMAIL, role: 'DRIVER' });
  await testApp.seedUser({ id: OTHER_ADMIN_ID, organizationId: OTHER_ORGANIZATION_ID, email: OTHER_ADMIN_EMAIL });
  return {
    testApp,
    adminToken: await testApp.signIn(admin),
    dispatcherToken: await testApp.signIn(dispatcher),
    driverToken: await testApp.signIn(driver),
  };
}

async function linkDriver(testApp: ReturnType<typeof buildTestApp>, adminToken: string): Promise<string> {
  const created = await request(testApp.app).post('/api/v1/drivers').set(bearer(adminToken))
    .send({ fullName: 'Jorge Huamán', documentNumber: 'DNI-40000001', phone: '+51 911 222 333', licenseNumber: 'L-40000001' });
  expect(created.status).toBe(201);
  const driverId = created.body.data.id as string;
  const bound = await request(testApp.app).put(`/api/v1/drivers/${driverId}/account`).set(bearer(adminToken))
    .send({ userId: DRIVER_ID });
  expect(bound.status).toBe(200);
  return driverId;
}

describe('GET /api/v1/users', () => {
  it('lists the organization accounts with the linked driver, never other tenants or hashes', async () => {
    const { testApp, adminToken } = await seedTeam();
    const driverId = await linkDriver(testApp, adminToken);

    const response = await request(testApp.app).get(USERS_PATH).set(bearer(adminToken));

    expect(response.status).toBe(200);
    expect(response.body.data.map((user: { email: string }) => user.email))
      .toEqual(['admin@lima.test', DISPATCHER_EMAIL, DRIVER_EMAIL]);
    const driver = response.body.data.find((user: { id: string }) => user.id === DRIVER_ID);
    expect(driver).toMatchObject({ role: 'DRIVER', lastLoginAt: null, driver: { id: driverId, fullName: 'Jorge Huamán' } });
    expect(response.body.data.find((user: { id: string }) => user.id === ADMIN_ID).driver).toBeNull();
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|hashed:/);
  });

  it('is ADMIN only', async () => {
    const { testApp, dispatcherToken, driverToken } = await seedTeam();

    for (const token of [dispatcherToken, driverToken]) {
      const response = await request(testApp.app).get(USERS_PATH).set(bearer(token));
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    }
    expect((await request(testApp.app).get(USERS_PATH)).status).toBe(401);
  });

  it('shows the last sign-in after a login', async () => {
    const { testApp, adminToken } = await seedTeam();

    const login = await request(testApp.app).post(LOGIN_PATH)
      .send({ organizationId: ORGANIZATION_ID, email: DISPATCHER_EMAIL, password: TEST_PASSWORD });
    expect(login.status).toBe(200);

    const response = await request(testApp.app).get(USERS_PATH).set(bearer(adminToken));
    const dispatcher = response.body.data.find((user: { id: string }) => user.id === DISPATCHER_ID);
    expect(dispatcher.lastLoginAt).toEqual(expect.any(String));
  });
});

describe('PATCH /api/v1/users/:userId', () => {
  it('updates name, role and status', async () => {
    const { testApp, adminToken } = await seedTeam();

    const response = await request(testApp.app).patch(`${USERS_PATH}/${DISPATCHER_ID}`).set(bearer(adminToken))
      .send({ firstName: 'Carla', paternalSurname: 'Benites', maternalSurname: '', role: 'ADMIN' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      firstName: 'Carla', paternalSurname: 'Benites', maternalSurname: null, role: 'ADMIN',
    });
  });

  it('disables an account so it can no longer sign in', async () => {
    const { testApp, adminToken } = await seedTeam();

    const response = await request(testApp.app).patch(`${USERS_PATH}/${DISPATCHER_ID}`).set(bearer(adminToken))
      .send({ status: 'disabled' });
    expect(response.status).toBe(200);

    const login = await request(testApp.app).post(LOGIN_PATH)
      .send({ organizationId: ORGANIZATION_ID, email: DISPATCHER_EMAIL, password: TEST_PASSWORD });
    expect(login.status).toBe(401);
  });

  it('answers 409 for a self change and for a linked driver role change', async () => {
    const { testApp, adminToken } = await seedTeam();
    await linkDriver(testApp, adminToken);

    const self = await request(testApp.app).patch(`${USERS_PATH}/${ADMIN_ID}`).set(bearer(adminToken))
      .send({ status: 'disabled' });
    expect(self.status).toBe(409);
    expect(self.body.error.code).toBe('IDENTITY_SELF_CHANGE_FORBIDDEN');

    const linked = await request(testApp.app).patch(`${USERS_PATH}/${DRIVER_ID}`).set(bearer(adminToken))
      .send({ role: 'DISPATCHER' });
    expect(linked.status).toBe(409);
    expect(linked.body.error.code).toBe('IDENTITY_DRIVER_ACCOUNT_LINKED');
  });

  it('rejects an empty or partial-name body and another tenant user', async () => {
    const { testApp, adminToken } = await seedTeam();

    const empty = await request(testApp.app).patch(`${USERS_PATH}/${DISPATCHER_ID}`).set(bearer(adminToken)).send({});
    expect(empty.status).toBe(400);
    const partial = await request(testApp.app).patch(`${USERS_PATH}/${DISPATCHER_ID}`).set(bearer(adminToken))
      .send({ firstName: 'Carla' });
    expect(partial.status).toBe(400);
    const foreign = await request(testApp.app).patch(`${USERS_PATH}/${OTHER_ADMIN_ID}`).set(bearer(adminToken))
      .send({ status: 'disabled' });
    expect(foreign.status).toBe(404);
  });
});

describe('PUT /api/v1/users/:userId/password', () => {
  it('sets a temporary password the user can sign in with', async () => {
    const { testApp, adminToken } = await seedTeam();

    const response = await request(testApp.app).put(`${USERS_PATH}/${DRIVER_ID}/password`).set(bearer(adminToken))
      .send({ password: 'temporal-2026' });
    expect(response.status).toBe(204);

    const oldLogin = await request(testApp.app).post(LOGIN_PATH)
      .send({ organizationId: ORGANIZATION_ID, email: DRIVER_EMAIL, password: TEST_PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(testApp.app).post(LOGIN_PATH)
      .send({ organizationId: ORGANIZATION_ID, email: DRIVER_EMAIL, password: 'temporal-2026' });
    expect(newLogin.status).toBe(200);
  });

  it('answers 400 for a weak password and 403 for a DISPATCHER', async () => {
    const { testApp, adminToken, dispatcherToken } = await seedTeam();

    const weak = await request(testApp.app).put(`${USERS_PATH}/${DRIVER_ID}/password`).set(bearer(adminToken))
      .send({ password: 'corta' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('IDENTITY_WEAK_PASSWORD');

    const forbidden = await request(testApp.app).put(`${USERS_PATH}/${DRIVER_ID}/password`).set(bearer(dispatcherToken))
      .send({ password: 'temporal-2026' });
    expect(forbidden.status).toBe(403);
  });
});
