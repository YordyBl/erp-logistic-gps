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

const VEHICLES_PATH = '/api/v1/vehicles';

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

function validVehicleBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    plate: 'abc-123',
    type: 'van',
    capacityKg: 800,
    ...overrides,
  };
}

async function createVehicle(
  testApp: TestApp,
  token: string,
  body: Record<string, unknown> = validVehicleBody(),
) {
  return request(testApp.app).post(VEHICLES_PATH).set(bearer(token)).send(body);
}

describe('POST /api/v1/vehicles', () => {
  it('creates a vehicle in the caller organization with a normalized plate', async () => {
    const { testApp, adminToken } = await seedActors();

    const response = await createVehicle(testApp, adminToken);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      organizationId: ORGANIZATION_ID,
      plate: 'ABC-123',
      type: 'van',
      capacityKg: 800,
      status: 'active',
    });
    expect(response.body.data.id).toEqual(expect.any(String));
    expect(response.body.data.createdAt).toEqual(expect.any(String));
    expect(response.body.data.updatedAt).toBe(response.body.data.createdAt);
    expect(response.headers.location).toBe(
      `${VEHICLES_PATH}/${response.body.data.id}`,
    );
  });

  it('returns 403 for a DRIVER token and allows a DISPATCHER', async () => {
    const { testApp, dispatcherToken, driverToken } = await seedActors();

    const dispatcher = await createVehicle(testApp, dispatcherToken);
    const driver = await createVehicle(testApp, driverToken);

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

    const response = await createVehicle(
      testApp,
      adminToken,
      validVehicleBody({ organizationId: OTHER_ORGANIZATION_ID }),
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'VEHICLE_INVALID_INPUT',
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

    const response = await createVehicle(
      testApp,
      adminToken,
      validVehicleBody({ capacityKg: -1 }),
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VEHICLE_INVALID_INPUT');
    expect(response.body.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'capacityKg' }),
      ]),
    );
  });

  it('returns 409 for a plate already used in the organization', async () => {
    const { testApp, adminToken } = await seedActors();

    await createVehicle(testApp, adminToken);
    const duplicate = await createVehicle(testApp, adminToken);

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('VEHICLE_INVARIANT_VIOLATION');
  });

  it('allows the same plate in another organization', async () => {
    const { testApp, adminToken, otherAdminToken } = await seedActors();

    await createVehicle(testApp, adminToken);
    const other = await createVehicle(testApp, otherAdminToken);

    expect(other.status).toBe(201);
    expect(other.body.data.organizationId).toBe(OTHER_ORGANIZATION_ID);
  });
});

describe('GET /api/v1/vehicles', () => {
  it('lists only the caller organization vehicles for a DRIVER', async () => {
    const { testApp, adminToken, otherAdminToken, driverToken } =
      await seedActors();

    await createVehicle(testApp, adminToken);
    await createVehicle(
      testApp,
      adminToken,
      validVehicleBody({ plate: 'XYZ-987' }),
    );
    await createVehicle(testApp, otherAdminToken);

    const response = await request(testApp.app)
      .get(VEHICLES_PATH)
      .set(bearer(driverToken));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(
      response.body.data.every(
        (vehicle: { organizationId: string }) =>
          vehicle.organizationId === ORGANIZATION_ID,
      ),
    ).toBe(true);
  });
});

describe('GET /api/v1/vehicles/:vehicleId', () => {
  it('returns one vehicle to a DRIVER and hides it from another organization', async () => {
    const { testApp, adminToken, otherAdminToken, driverToken } =
      await seedActors();
    const created = await createVehicle(testApp, adminToken);
    const vehicleId = created.body.data.id as string;

    const own = await request(testApp.app)
      .get(`${VEHICLES_PATH}/${vehicleId}`)
      .set(bearer(driverToken));

    expect(own.status).toBe(200);
    expect(own.body.data.id).toBe(vehicleId);

    const crossOrganization = await request(testApp.app)
      .get(`${VEHICLES_PATH}/${vehicleId}`)
      .set(bearer(otherAdminToken));

    expect(crossOrganization.status).toBe(404);
    expect(crossOrganization.body.error.code).toBe('VEHICLE_NOT_FOUND');
    expect(crossOrganization.body.error.message).toBe(
      `Vehicle ${vehicleId} was not found`,
    );
  });

  it('returns 400 for a malformed vehicle id', async () => {
    const { testApp, adminToken } = await seedActors();

    const response = await request(testApp.app)
      .get(`${VEHICLES_PATH}/not-a-uuid`)
      .set(bearer(adminToken));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VEHICLE_INVALID_INPUT');
  });
});

describe('PATCH /api/v1/vehicles/:vehicleId', () => {
  it('updates mutable fields, including clearing capacity', async () => {
    const { testApp, adminToken } = await seedActors();
    const created = await createVehicle(testApp, adminToken);
    const vehicleId = created.body.data.id as string;

    const response = await request(testApp.app)
      .patch(`${VEHICLES_PATH}/${vehicleId}`)
      .set(bearer(adminToken))
      .send({ capacityKg: null, status: 'inactive' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: vehicleId,
      organizationId: ORGANIZATION_ID,
      plate: 'ABC-123',
      type: 'van',
      capacityKg: null,
      status: 'inactive',
      createdAt: created.body.data.createdAt,
    });
    expect(response.body.data.updatedAt).toEqual(expect.any(String));
  });

  it('allows a DISPATCHER and rejects a DRIVER', async () => {
    const { testApp, adminToken, dispatcherToken, driverToken } =
      await seedActors();
    const created = await createVehicle(testApp, adminToken);
    const vehicleId = created.body.data.id as string;

    const dispatcher = await request(testApp.app)
      .patch(`${VEHICLES_PATH}/${vehicleId}`)
      .set(bearer(dispatcherToken))
      .send({ type: 'truck' });
    const driver = await request(testApp.app)
      .patch(`${VEHICLES_PATH}/${vehicleId}`)
      .set(bearer(driverToken))
      .send({ type: 'truck' });

    expect(dispatcher.status).toBe(200);
    expect(dispatcher.body.data.type).toBe('truck');
    expect(driver.status).toBe(403);
    expect(driver.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('returns 404 and writes nothing when another organization updates it', async () => {
    const { testApp, adminToken, otherAdminToken } = await seedActors();
    const created = await createVehicle(testApp, adminToken);
    const vehicleId = created.body.data.id as string;

    const crossOrganization = await request(testApp.app)
      .patch(`${VEHICLES_PATH}/${vehicleId}`)
      .set(bearer(otherAdminToken))
      .send({ type: 'truck' });

    expect(crossOrganization.status).toBe(404);
    expect(crossOrganization.body.error.code).toBe('VEHICLE_NOT_FOUND');

    const own = await request(testApp.app)
      .get(`${VEHICLES_PATH}/${vehicleId}`)
      .set(bearer(adminToken));

    expect(own.body.data.type).toBe('van');
  });

  it('returns 400 for an empty patch or a malformed vehicle id', async () => {
    const { testApp, adminToken } = await seedActors();
    const created = await createVehicle(testApp, adminToken);
    const vehicleId = created.body.data.id as string;

    const empty = await request(testApp.app)
      .patch(`${VEHICLES_PATH}/${vehicleId}`)
      .set(bearer(adminToken))
      .send({});
    const malformed = await request(testApp.app)
      .patch(`${VEHICLES_PATH}/not-a-uuid`)
      .set(bearer(adminToken))
      .send({ type: 'truck' });

    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VEHICLE_INVALID_INPUT');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VEHICLE_INVALID_INPUT');
  });
});
