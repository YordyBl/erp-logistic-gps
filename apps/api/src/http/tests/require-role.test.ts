import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_EMAIL,
  ADMIN_ID,
  bearer,
  buildTestApp,
  DISPATCHER_EMAIL,
  DISPATCHER_ID,
  DRIVER_EMAIL,
  DRIVER_ID,
  ORGANIZATION_ID,
  TEST_PASSWORD,
  type TestApp,
} from './support/test-app.js';

const USERS_PATH = '/api/v1/users';
const LOGIN_PATH = '/api/v1/auth/login';

const NEW_USER_EMAIL = 'new.dispatcher@lima.test';
const NEW_USER_PASSWORD = 'temporary-pass-1';

interface SeededActors {
  readonly testApp: TestApp;
  readonly adminToken: string;
  readonly dispatcherToken: string;
  readonly driverToken: string;
}

async function seedActors(): Promise<SeededActors> {
  const testApp = buildTestApp();
  await testApp.seedOrganization();

  const admin = await testApp.seedUser({
    id: ADMIN_ID,
    email: ADMIN_EMAIL,
    password: TEST_PASSWORD,
    role: 'ADMIN',
  });
  const dispatcher = await testApp.seedUser({
    id: DISPATCHER_ID,
    email: DISPATCHER_EMAIL,
    password: TEST_PASSWORD,
    role: 'DISPATCHER',
  });
  const driver = await testApp.seedUser({
    id: DRIVER_ID,
    email: DRIVER_EMAIL,
    password: TEST_PASSWORD,
    role: 'DRIVER',
  });

  return {
    testApp,
    adminToken: await testApp.signIn(admin),
    dispatcherToken: await testApp.signIn(dispatcher),
    driverToken: await testApp.signIn(driver),
  };
}

function validUserBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: NEW_USER_EMAIL,
    password: NEW_USER_PASSWORD,
    role: 'DISPATCHER',
    ...overrides,
  };
}

describe('POST /api/v1/users (ADMIN only)', () => {
  it('creates a user in the caller organization and the new user can log in', async () => {
    const { testApp, adminToken } = await seedActors();

    const response = await request(testApp.app)
      .post(USERS_PATH)
      .set(bearer(adminToken))
      .send(validUserBody());

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      organizationId: ORGANIZATION_ID,
      email: NEW_USER_EMAIL,
      role: 'DISPATCHER',
      status: 'active',
    });
    expect(response.body.data.id).toEqual(expect.any(String));
    expect(response.body.data.passwordHash).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(NEW_USER_PASSWORD);

    const login = await request(testApp.app)
      .post(LOGIN_PATH)
      .send({
        organizationId: ORGANIZATION_ID,
        email: NEW_USER_EMAIL,
        password: NEW_USER_PASSWORD,
      });

    expect(login.status).toBe(200);
    expect(login.body.data.user.role).toBe('DISPATCHER');
  });

  it('returns 403 for a DISPATCHER or DRIVER token', async () => {
    const { testApp, dispatcherToken, driverToken } = await seedActors();

    const dispatcher = await request(testApp.app)
      .post(USERS_PATH)
      .set(bearer(dispatcherToken))
      .send(validUserBody());
    const driver = await request(testApp.app)
      .post(USERS_PATH)
      .set(bearer(driverToken))
      .send(validUserBody());

    for (const [response, role] of [
      [dispatcher, 'DISPATCHER'],
      [driver, 'DRIVER'],
    ] as const) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
      expect(response.body.error.message).toBe(
        `Role ${role} is not allowed to access this resource`,
      );
      expect(response.body.error.details).toEqual({
        requiredRoles: ['ADMIN'],
        actualRole: role,
      });
    }
  });

  it('returns 401 for a missing token', async () => {
    const { testApp } = await seedActors();

    const response = await request(testApp.app).post(USERS_PATH).send(validUserBody());

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_TOKEN_MISSING');
  });

  it('rejects an organizationId or actorUserId injected through the body', async () => {
    const { testApp, adminToken } = await seedActors();

    const response = await request(testApp.app)
      .post(USERS_PATH)
      .set(bearer(adminToken))
      .send(validUserBody({ organizationId: ORGANIZATION_ID, actorUserId: ADMIN_ID }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('IDENTITY_INVALID_INPUT');
  });

  it('returns 409 for an email already used in the organization', async () => {
    const { testApp, adminToken } = await seedActors();

    const response = await request(testApp.app)
      .post(USERS_PATH)
      .set(bearer(adminToken))
      .send(validUserBody({ email: DISPATCHER_EMAIL }));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('IDENTITY_EMAIL_ALREADY_IN_USE');
  });

  it('returns 400 with stable reasons for a weak password', async () => {
    const { testApp, adminToken } = await seedActors();

    const response = await request(testApp.app)
      .post(USERS_PATH)
      .set(bearer(adminToken))
      .send(validUserBody({ password: 'short' }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('IDENTITY_WEAK_PASSWORD');
    expect(response.body.error.details).toEqual({
      reasons: ['minimum_length', 'digit_required'],
    });
    expect(JSON.stringify(response.body)).not.toContain('short');
  });
});
