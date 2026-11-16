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
    expect(response.body.meta).toEqual({
      page: 1, pageSize: 20, total: 2, counts: { status: { active: 2, inactive: 0 } },
    });
  });

  /** Four own vehicles (one inactive) and one in the other organization. */
  async function seedFleet() {
    const actors = await seedActors();
    const create = async (token: string, overrides: Record<string, unknown>) => {
      const response = await createVehicle(actors.testApp, token, validVehicleBody(overrides));
      expect(response.status).toBe(201);
      return response.body.data as { id: string };
    };
    const delta = await create(actors.adminToken, { plate: 'DDD-400', type: 'Camión 5T' });
    const alpha = await create(actors.adminToken, { plate: 'AAA-100', type: 'Furgoneta' });
    const charlie = await create(actors.adminToken, { plate: 'CCC-300', type: 'Moto_carga', status: 'inactive' });
    const bravo = await create(actors.adminToken, { plate: 'BBB-200', type: 'Camioneta 100%' });
    const foreign = await create(actors.otherAdminToken, { plate: 'AAA-100', type: 'Furgoneta' });
    return { ...actors, delta, alpha, charlie, bravo, foreign };
  }

  it('pages, sorts by plate or creation, filters by status and ids and searches plate and type', async () => {
    const { testApp, adminToken, otherAdminToken, alpha, bravo, charlie, delta, foreign } = await seedFleet();
    const list = (query: Record<string, string>) =>
      request(testApp.app).get(VEHICLES_PATH).query(query).set(bearer(adminToken));
    const ids = async (query: Record<string, string>) =>
      (await list(query)).body.data.map((vehicle: { id: string }) => vehicle.id);

    await expect(ids({})).resolves.toEqual([alpha.id, bravo.id, charlie.id, delta.id]);
    await expect(ids({ sort: 'plate:desc' })).resolves.toEqual([delta.id, charlie.id, bravo.id, alpha.id]);
    await expect(ids({ sort: 'createdAt:asc' })).resolves.toEqual([delta.id, alpha.id, charlie.id, bravo.id]);

    const second = await list({ page: '2', pageSize: '3' });
    expect(second.body.data.map((vehicle: { id: string }) => vehicle.id)).toEqual([delta.id]);
    expect(second.body.meta).toEqual({
      page: 2, pageSize: 3, total: 4, counts: { status: { active: 3, inactive: 1 } },
    });

    const inactive = await list({ status: 'inactive' });
    expect(inactive.body.data.map((vehicle: { id: string }) => vehicle.id)).toEqual([charlie.id]);
    expect(inactive.body.meta).toMatchObject({ total: 1, counts: { status: { active: 3, inactive: 1 } } });

    await expect(ids({ q: 'bbb' })).resolves.toEqual([bravo.id]);
    await expect(ids({ q: 'camion' })).resolves.toEqual([bravo.id]);
    await expect(ids({ q: 'CAMIÓN' })).resolves.toEqual([delta.id]);
    await expect(ids({ q: '100%' })).resolves.toEqual([bravo.id]);
    await expect(ids({ q: '_' })).resolves.toEqual([charlie.id]);

    await expect(ids({ ids: `${alpha.id},${foreign.id}` })).resolves.toEqual([alpha.id]);
    const other = await request(testApp.app).get(VEHICLES_PATH).set(bearer(otherAdminToken));
    expect(other.body.data.map((vehicle: { id: string }) => vehicle.id)).toEqual([foreign.id]);
  });

  it.each([
    ['an unknown sort field', { sort: 'type:asc' }],
    ['a page size above 100', { pageSize: '101' }],
    ['an unknown status', { status: 'retired' }],
    ['a malformed id', { ids: 'nope' }],
    ['an unknown parameter', { limit: '5' }],
  ])('returns 400 for %s', async (_label, query) => {
    const { testApp, adminToken } = await seedActors();

    const response = await request(testApp.app).get(VEHICLES_PATH).query(query).set(bearer(adminToken));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VEHICLE_INVALID_INPUT');
  });
});

describe('GET /api/v1/vehicles/options', () => {
  it('returns the whole tenant fleet, oldest first, for every role', async () => {
    const { testApp, driverToken, alpha, bravo, charlie, delta } = await seedFleetForOptions();

    const response = await request(testApp.app).get(`${VEHICLES_PATH}/options`).set(bearer(driverToken));

    expect(response.status).toBe(200);
    expect(response.body.data.map((vehicle: { id: string }) => vehicle.id))
      .toEqual([delta.id, alpha.id, charlie.id, bravo.id]);
    expect(response.body.meta).toBeUndefined();
  });

  async function seedFleetForOptions() {
    const actors = await seedActors();
    const create = async (overrides: Record<string, unknown>) =>
      (await createVehicle(actors.testApp, actors.adminToken, validVehicleBody(overrides))).body.data as { id: string };
    const delta = await create({ plate: 'DDD-400' });
    const alpha = await create({ plate: 'AAA-100' });
    const charlie = await create({ plate: 'CCC-300', status: 'inactive' });
    const bravo = await create({ plate: 'BBB-200' });
    await createVehicle(actors.testApp, actors.otherAdminToken, validVehicleBody({ plate: 'ZZZ-999' }));
    return { ...actors, delta, alpha, charlie, bravo };
  }
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
