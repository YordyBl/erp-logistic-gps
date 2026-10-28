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
  OTHER_ADMIN_EMAIL,
  OTHER_ADMIN_ID,
  OTHER_ORGANIZATION_ID,
  type TestApp,
} from './support/test-app.js';

const DRIVERS_PATH = '/api/v1/drivers';

interface SeededActors {
  readonly testApp: TestApp;
  readonly adminToken: string;
  readonly dispatcherToken: string;
  readonly driverToken: string;
  readonly otherAdminToken: string;
}

async function seedActors(): Promise<SeededActors> {
  const testApp = buildTestApp();
  await testApp.seedOrganization();
  await testApp.seedOrganization({
    id: OTHER_ORGANIZATION_ID,
    name: 'Callao Freight',
  });

  const admin = await testApp.seedUser({
    id: ADMIN_ID,
    email: ADMIN_EMAIL,
    role: 'ADMIN',
  });
  const dispatcher = await testApp.seedUser({
    id: DISPATCHER_ID,
    email: DISPATCHER_EMAIL,
    role: 'DISPATCHER',
  });
  const driver = await testApp.seedUser({
    id: DRIVER_ID,
    email: DRIVER_EMAIL,
    role: 'DRIVER',
  });
  const otherAdmin = await testApp.seedUser({
    id: OTHER_ADMIN_ID,
    organizationId: OTHER_ORGANIZATION_ID,
    email: OTHER_ADMIN_EMAIL,
    role: 'ADMIN',
  });

  return {
    testApp,
    adminToken: await testApp.signIn(admin),
    dispatcherToken: await testApp.signIn(dispatcher),
    driverToken: await testApp.signIn(driver),
    otherAdminToken: await testApp.signIn(otherAdmin),
  };
}

function validDriverBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    fullName: 'Luis Quispe',
    documentNumber: 'dni-12345678',
    phone: '+51 911 222 333',
    licenseNumber: 'q-987654',
    ...overrides,
  };
}

async function createDriver(
  testApp: TestApp,
  token: string,
  body: Record<string, unknown> = validDriverBody(),
) {
  return request(testApp.app).post(DRIVERS_PATH).set(bearer(token)).send(body);
}

describe('PUT /api/v1/drivers/:driverId/account', () => {
  it('binds one active DRIVER account only through ADMIN, without exposing other tenants', async () => {
    const { testApp, adminToken, dispatcherToken, driverToken, otherAdminToken } = await seedActors();
    const first = await createDriver(testApp, adminToken);
    const second = await createDriver(testApp, adminToken,
      validDriverBody({ documentNumber: 'dni-87654321', licenseNumber: 'q-123456' }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const path = `${DRIVERS_PATH}/${first.body.data.id as string}/account`;
    const body = { userId: DRIVER_ID };
    const before = await request(testApp.app).get(first.headers.location as string).set(bearer(adminToken));
    expect((await request(testApp.app).patch(first.headers.location as string)
      .set(bearer(adminToken)).send(body)).status).toBe(400);
    expect((await request(testApp.app).get(path).set(bearer(adminToken))).body.data)
      .toEqual({ driverId: first.body.data.id, userId: null });
    expect((await request(testApp.app).get(path).set(bearer(dispatcherToken))).status).toBe(403);
    expect((await request(testApp.app).get(path).set(bearer(driverToken))).status).toBe(403);
    expect((await request(testApp.app).put(path).set(bearer(dispatcherToken)).send(body)).status).toBe(403);
    expect((await request(testApp.app).put(path).set(bearer(driverToken)).send(body)).status).toBe(403);
    expect((await request(testApp.app).put(path).set(bearer(otherAdminToken)).send(body)).status).toBe(404);
    expect((await request(testApp.app).put(path).set(bearer(adminToken))
      .send({ userId: OTHER_ADMIN_ID })).status).toBe(404);
    expect((await request(testApp.app).put(path).set(bearer(adminToken))
      .send({ userId: ADMIN_ID })).status).toBe(409);
    expect((await request(testApp.app).get(first.headers.location as string)
      .set(bearer(adminToken))).body).toEqual(before.body);
    const linked = await request(testApp.app).put(path).set(bearer(adminToken)).send(body);
    expect(linked.status).toBe(200);
    expect(linked.body.data).toEqual({ driverId: first.body.data.id, userId: DRIVER_ID });
    expect((await request(testApp.app).get(path).set(bearer(adminToken))).body).toEqual(linked.body);
    expect((await request(testApp.app).put(`${DRIVERS_PATH}/${second.body.data.id as string}/account`)
      .set(bearer(adminToken)).send(body)).status).toBe(409);
    const unlinked = await request(testApp.app).put(path).set(bearer(adminToken)).send({ userId: null });
    expect(unlinked.body.data).toEqual({ driverId: first.body.data.id, userId: null });
    expect((await request(testApp.app).put(`${DRIVERS_PATH}/${second.body.data.id as string}/account`)
      .set(bearer(adminToken)).send(body)).status).toBe(200);
  });
});

describe('POST /api/v1/drivers', () => {
  it('creates a driver in the caller organization with normalized values', async () => {
    const { testApp, adminToken } = await seedActors();

    const response = await createDriver(testApp, adminToken);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      organizationId: ORGANIZATION_ID,
      fullName: 'Luis Quispe',
      documentNumber: 'DNI-12345678',
      phone: '+51 911 222 333',
      licenseNumber: 'Q-987654',
      status: 'active',
    });
    expect(response.body.data.id).toEqual(expect.any(String));
    expect(response.body.data.createdAt).toEqual(expect.any(String));
    expect(response.body.data.updatedAt).toBe(response.body.data.createdAt);
    expect(response.headers.location).toBe(
      `${DRIVERS_PATH}/${response.body.data.id}`,
    );
  });

  it('returns 403 for a DRIVER token and allows a DISPATCHER', async () => {
    const { testApp, dispatcherToken, driverToken } = await seedActors();

    const dispatcher = await createDriver(testApp, dispatcherToken);
    const driver = await createDriver(testApp, driverToken);

    expect(dispatcher.status).toBe(201);
    expect(driver.status).toBe(403);
    expect(driver.body.error).toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: expect.any(String),
      details: {
        requiredRoles: ['ADMIN', 'DISPATCHER'],
        actualRole: 'DRIVER',
      },
      correlationId: expect.any(String),
    });
  });

  it('rejects an organizationId injected through the body', async () => {
    const { testApp, adminToken } = await seedActors();

    const response = await createDriver(
      testApp,
      adminToken,
      validDriverBody({ organizationId: OTHER_ORGANIZATION_ID }),
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'DRIVER_INVALID_INPUT',
      message: expect.any(String),
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ message: 'Unrecognized key: "organizationId"', path: '' }),
        ]),
      },
      correlationId: expect.any(String),
    });
  });

  it('returns 400 with field paths for invalid input', async () => {
    const { testApp, adminToken } = await seedActors();

    const response = await createDriver(
      testApp,
      adminToken,
      validDriverBody({ documentNumber: '' }),
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DRIVER_INVALID_INPUT');
    expect(response.body.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'documentNumber' }),
      ]),
    );
  });

  it('returns 409 for a duplicate document number in the organization', async () => {
    const { testApp, adminToken } = await seedActors();

    await createDriver(testApp, adminToken);
    const duplicate = await createDriver(testApp, adminToken);

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DRIVER_INVARIANT_VIOLATION');
  });

  it('allows the same document number in another organization', async () => {
    const { testApp, adminToken, otherAdminToken } = await seedActors();

    await createDriver(testApp, adminToken);
    const other = await createDriver(testApp, otherAdminToken);

    expect(other.status).toBe(201);
    expect(other.body.data.organizationId).toBe(OTHER_ORGANIZATION_ID);
  });
});

describe('GET /api/v1/drivers', () => {
  it('lists only the caller organization drivers for a DRIVER', async () => {
    const { testApp, adminToken, otherAdminToken, driverToken } =
      await seedActors();

    await createDriver(testApp, adminToken);
    await createDriver(
      testApp,
      adminToken,
      validDriverBody({ documentNumber: 'DNI-87654321' }),
    );
    await createDriver(testApp, otherAdminToken);

    const response = await request(testApp.app)
      .get(DRIVERS_PATH)
      .set(bearer(driverToken));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(
      response.body.data.every(
        (driver: { organizationId: string }) =>
          driver.organizationId === ORGANIZATION_ID,
      ),
    ).toBe(true);
  });
});

describe('GET /api/v1/drivers/:driverId', () => {
  it('returns one driver to a DRIVER and hides it from another organization', async () => {
    const { testApp, adminToken, otherAdminToken, driverToken } =
      await seedActors();
    const created = await createDriver(testApp, adminToken);
    const driverId = created.body.data.id as string;

    const own = await request(testApp.app)
      .get(`${DRIVERS_PATH}/${driverId}`)
      .set(bearer(driverToken));

    expect(own.status).toBe(200);
    expect(own.body.data.id).toBe(driverId);

    const crossOrganization = await request(testApp.app)
      .get(`${DRIVERS_PATH}/${driverId}`)
      .set(bearer(otherAdminToken));

    expect(crossOrganization.status).toBe(404);
    expect(crossOrganization.body.error.code).toBe('DRIVER_NOT_FOUND');
    expect(crossOrganization.body.error.message).toBe(
      `Driver ${driverId} was not found`,
    );
  });

  it('returns 400 for a malformed driver id', async () => {
    const { testApp, adminToken } = await seedActors();

    const response = await request(testApp.app)
      .get(`${DRIVERS_PATH}/not-a-uuid`)
      .set(bearer(adminToken));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DRIVER_INVALID_INPUT');
  });
});

describe('PATCH /api/v1/drivers/:driverId', () => {
  it('updates mutable fields and keeps identity and creation time', async () => {
    const { testApp, adminToken } = await seedActors();
    const created = await createDriver(testApp, adminToken);
    const driverId = created.body.data.id as string;

    const response = await request(testApp.app)
      .patch(`${DRIVERS_PATH}/${driverId}`)
      .set(bearer(adminToken))
      .send({ fullName: 'Luis Quispe Rojas', status: 'inactive' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: driverId,
      organizationId: ORGANIZATION_ID,
      fullName: 'Luis Quispe Rojas',
      documentNumber: 'DNI-12345678',
      status: 'inactive',
      createdAt: created.body.data.createdAt,
    });
    expect(response.body.data.phone).toBe('+51 911 222 333');
    expect(response.body.data.updatedAt).toEqual(expect.any(String));
  });

  it('allows a DISPATCHER and rejects a DRIVER', async () => {
    const { testApp, adminToken, dispatcherToken, driverToken } =
      await seedActors();
    const created = await createDriver(testApp, adminToken);
    const driverId = created.body.data.id as string;

    const dispatcher = await request(testApp.app)
      .patch(`${DRIVERS_PATH}/${driverId}`)
      .set(bearer(dispatcherToken))
      .send({ phone: '+51 999 888 777' });
    const driver = await request(testApp.app)
      .patch(`${DRIVERS_PATH}/${driverId}`)
      .set(bearer(driverToken))
      .send({ fullName: 'Hijacked Name' });

    expect(dispatcher.status).toBe(200);
    expect(dispatcher.body.data.phone).toBe('+51 999 888 777');
    expect(driver.status).toBe(403);
    expect(driver.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('returns 404 and writes nothing when another organization updates it', async () => {
    const { testApp, adminToken, otherAdminToken } = await seedActors();
    const created = await createDriver(testApp, adminToken);
    const driverId = created.body.data.id as string;

    const crossOrganization = await request(testApp.app)
      .patch(`${DRIVERS_PATH}/${driverId}`)
      .set(bearer(otherAdminToken))
      .send({ fullName: 'Cross Tenant' });

    expect(crossOrganization.status).toBe(404);
    expect(crossOrganization.body.error.code).toBe('DRIVER_NOT_FOUND');

    const own = await request(testApp.app)
      .get(`${DRIVERS_PATH}/${driverId}`)
      .set(bearer(adminToken));

    expect(own.body.data.fullName).toBe('Luis Quispe');
  });

  it('returns 400 for an empty patch or a malformed driver id', async () => {
    const { testApp, adminToken } = await seedActors();
    const created = await createDriver(testApp, adminToken);
    const driverId = created.body.data.id as string;

    const empty = await request(testApp.app)
      .patch(`${DRIVERS_PATH}/${driverId}`)
      .set(bearer(adminToken))
      .send({});
    const malformed = await request(testApp.app)
      .patch(`${DRIVERS_PATH}/not-a-uuid`)
      .set(bearer(adminToken))
      .send({ fullName: 'Luis Quispe' });

    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('DRIVER_INVALID_INPUT');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('DRIVER_INVALID_INPUT');
  });
});
