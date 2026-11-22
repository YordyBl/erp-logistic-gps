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

const CUSTOMERS_PATH = '/api/v1/customers';

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

function validCustomerBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    publicCode: 'cus-2026-0001',
    name: 'Distribuidora Lima SAC',
    contactName: 'Ana Torres',
    contactEmail: 'Contact@Distribuidora.PE',
    contactPhone: '+51 987 654 321',
    ...overrides,
  };
}

async function createCustomer(
  testApp: TestApp,
  token: string,
  body: Record<string, unknown> = validCustomerBody(),
) {
  return request(testApp.app)
    .post(CUSTOMERS_PATH)
    .set(bearer(token))
    .send(body);
}

describe('POST /api/v1/customers', () => {
  it('creates a customer in the caller organization with normalized values', async () => {
    const { testApp, adminToken } = await seedActors();

    const response = await createCustomer(testApp, adminToken);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      organizationId: ORGANIZATION_ID,
      publicCode: 'CUS-2026-0001',
      name: 'Distribuidora Lima SAC',
      contactName: 'Ana Torres',
      contactEmail: 'contact@distribuidora.pe',
      contactPhone: '+51 987 654 321',
      status: 'active',
    });
    expect(response.body.data.id).toEqual(expect.any(String));
    expect(response.body.data.createdAt).toEqual(expect.any(String));
    expect(response.headers.location).toBe(
      `${CUSTOMERS_PATH}/${response.body.data.id}`,
    );
  });

  it('allows a DISPATCHER to create a customer', async () => {
    const { testApp, dispatcherToken } = await seedActors();

    const response = await createCustomer(testApp, dispatcherToken);

    expect(response.status).toBe(201);
  });

  it('returns 403 for a DRIVER token', async () => {
    const { testApp, driverToken } = await seedActors();

    const response = await createCustomer(testApp, driverToken);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    expect(response.body.error.details).toEqual({
      requiredRoles: ['ADMIN', 'DISPATCHER'],
      actualRole: 'DRIVER',
    });
  });

  it('returns 401 without a token', async () => {
    const { testApp } = await seedActors();

    const response = await request(testApp.app)
      .post(CUSTOMERS_PATH)
      .send(validCustomerBody());

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_TOKEN_MISSING');
  });

  it('rejects an organizationId injected through the body', async () => {
    const { testApp, adminToken } = await seedActors();

    const response = await createCustomer(
      testApp,
      adminToken,
      validCustomerBody({ organizationId: OTHER_ORGANIZATION_ID }),
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'CUSTOMER_INVALID_INPUT',
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

    const response = await createCustomer(
      testApp,
      adminToken,
      validCustomerBody({ name: '' }),
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CUSTOMER_INVALID_INPUT');
    expect(response.body.error.details.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'name' })]),
    );
    expect(JSON.stringify(response.body)).not.toContain('Distribuidora');
  });

  it('returns 409 for a public code already used in the organization', async () => {
    const { testApp, adminToken } = await seedActors();

    await createCustomer(testApp, adminToken);
    const duplicate = await createCustomer(testApp, adminToken);

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CUSTOMER_INVARIANT_VIOLATION');
  });

  it('allows the same public code in another organization', async () => {
    const { testApp, adminToken, otherAdminToken } = await seedActors();

    await createCustomer(testApp, adminToken);
    const other = await createCustomer(testApp, otherAdminToken);

    expect(other.status).toBe(201);
    expect(other.body.data.organizationId).toBe(OTHER_ORGANIZATION_ID);
  });
});

describe('GET /api/v1/customers', () => {
  it('denies DRIVER access to the customer catalog', async () => {
    const { testApp, adminToken, otherAdminToken, driverToken } =
      await seedActors();

    await createCustomer(testApp, adminToken);
    await createCustomer(
      testApp,
      adminToken,
      validCustomerBody({ publicCode: 'CUS-2026-0002' }),
    );
    await createCustomer(testApp, otherAdminToken);

    const response = await request(testApp.app)
      .get(CUSTOMERS_PATH)
      .set(bearer(driverToken));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('returns 401 without a token', async () => {
    const { testApp } = await seedActors();

    const response = await request(testApp.app).get(CUSTOMERS_PATH);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_TOKEN_MISSING');
  });

  /** Four own customers (one inactive) and one in the other organization. */
  async function seedCatalog() {
    const actors = await seedActors();
    const create = async (token: string, overrides: Record<string, unknown>) => {
      const response = await createCustomer(actors.testApp, token, validCustomerBody(overrides));
      expect(response.status).toBe(201);
      return response.body.data as { id: string; name: string };
    };
    const delta = await create(actors.adminToken, {
      publicCode: 'CUS-DELTA', name: 'Delta Courier', contactName: 'Diego Paz',
      contactEmail: 'ops@delta.pe', contactPhone: '+51 911 111 111',
    });
    const alpha = await create(actors.adminToken, {
      publicCode: 'CUS-ALPHA', name: 'Alpha Retail', contactName: 'Ana Quispe',
      contactEmail: 'ventas@alpha.pe', contactPhone: '+51 922 222 222',
    });
    const charlie = await create(actors.dispatcherToken, {
      publicCode: 'CUS-CHARLIE', name: 'Charlie Foods', contactName: 'Carla Ríos',
      contactEmail: 'compras@charlie_foods.pe', contactPhone: '+51 933 333 333', status: 'inactive',
    });
    const bravo = await create(actors.adminToken, {
      publicCode: 'CUS-BRAVO', name: 'Bravo 100% Market', contactName: 'Bruno Díaz',
      contactEmail: 'hola@bravo.pe', contactPhone: '+51 944 444 444',
    });
    const foreign = await create(actors.otherAdminToken, {
      publicCode: 'CUS-ALPHA', name: 'Alpha Foránea', contactName: 'Ana Otra',
    });
    return { ...actors, delta, alpha, charlie, bravo, foreign };
  }

  it('returns the first page by name with meta and status counts, scoped to the organization', async () => {
    const { testApp, adminToken, dispatcherToken, alpha, bravo, charlie, delta } = await seedCatalog();

    const response = await request(testApp.app).get(CUSTOMERS_PATH).set(bearer(dispatcherToken));

    expect(response.status).toBe(200);
    expect(response.body.data.map((customer: { id: string }) => customer.id))
      .toEqual([alpha.id, bravo.id, charlie.id, delta.id]);
    expect(response.body.data[0]).toMatchObject({
      organizationId: ORGANIZATION_ID, publicCode: 'CUS-ALPHA', name: 'Alpha Retail', status: 'active',
    });
    expect(response.body.meta).toEqual({
      page: 1, pageSize: 20, total: 4, counts: { status: { active: 3, inactive: 1 } },
    });

    const admin = await request(testApp.app).get(CUSTOMERS_PATH).set(bearer(adminToken));
    expect(admin.body.meta.total).toBe(4);
  });

  it('pages, sorts, filters by status and ids, and searches every contact field', async () => {
    const { testApp, adminToken, otherAdminToken, alpha, bravo, charlie, delta, foreign } = await seedCatalog();
    const list = (query: Record<string, string>) =>
      request(testApp.app).get(CUSTOMERS_PATH).query(query).set(bearer(adminToken));
    const ids = async (query: Record<string, string>) =>
      (await list(query)).body.data.map((customer: { id: string }) => customer.id);

    await expect(ids({ sort: 'name:desc' })).resolves.toEqual([delta.id, charlie.id, bravo.id, alpha.id]);
    await expect(ids({ sort: 'createdAt:asc' })).resolves.toEqual([delta.id, alpha.id, charlie.id, bravo.id]);
    await expect(ids({ sort: 'createdAt:desc' })).resolves.toEqual([bravo.id, charlie.id, alpha.id, delta.id]);

    const second = await list({ page: '2', pageSize: '3' });
    expect(second.body.data.map((customer: { id: string }) => customer.id)).toEqual([delta.id]);
    expect(second.body.meta).toEqual({
      page: 2, pageSize: 3, total: 4, counts: { status: { active: 3, inactive: 1 } },
    });
    const beyond = await list({ page: '9' });
    expect(beyond.body.data).toEqual([]);
    expect(beyond.body.meta.total).toBe(4);

    // The status facet ignores its own filter.
    const inactive = await list({ status: 'inactive' });
    expect(inactive.body.data.map((customer: { id: string }) => customer.id)).toEqual([charlie.id]);
    expect(inactive.body.meta).toMatchObject({ total: 1, counts: { status: { active: 3, inactive: 1 } } });
    await expect(ids({ status: 'active,inactive' })).resolves.toHaveLength(4);

    await expect(ids({ q: 'charlie' })).resolves.toEqual([charlie.id]);
    await expect(ids({ q: 'cus-bravo' })).resolves.toEqual([bravo.id]);
    await expect(ids({ q: 'DIEGO' })).resolves.toEqual([delta.id]);
    await expect(ids({ q: 'ventas@' })).resolves.toEqual([alpha.id]);
    await expect(ids({ q: '933 333' })).resolves.toEqual([charlie.id]);
    // Wildcards match literally.
    await expect(ids({ q: '100%' })).resolves.toEqual([bravo.id]);
    await expect(ids({ q: '_' })).resolves.toEqual([charlie.id]);
    await expect(ids({ q: '   ' })).resolves.toHaveLength(4);

    const searched = await list({ q: 'alpha', status: 'inactive' });
    expect(searched.body.data).toEqual([]);
    expect(searched.body.meta).toMatchObject({ total: 0, counts: { status: { active: 1, inactive: 0 } } });

    // Another organization's id is never returned, even when asked for.
    await expect(ids({ ids: `${alpha.id},${foreign.id},${bravo.id}` })).resolves.toEqual([alpha.id, bravo.id]);
    const other = await request(testApp.app).get(CUSTOMERS_PATH).set(bearer(otherAdminToken));
    expect(other.body.data.map((customer: { id: string }) => customer.id)).toEqual([foreign.id]);
    expect(other.body.meta.counts.status).toEqual({ active: 1, inactive: 0 });
  });

  it.each([
    ['an unknown sort field', { sort: 'publicCode:asc' }],
    ['an unknown sort direction', { sort: 'name:up' }],
    ['a page size above 100', { pageSize: '101' }],
    ['a zero page', { page: '0' }],
    ['a non-numeric page', { page: 'two' }],
    ['an unknown status', { status: 'archived' }],
    ['a malformed id', { ids: 'not-a-uuid' }],
    ['an organizationId parameter', { organizationId: OTHER_ORGANIZATION_ID }],
    ['an unknown parameter', { limit: '5' }],
  ])('returns 400 with issue details for %s', async (_label, query) => {
    const { testApp, adminToken } = await seedActors();

    const response = await request(testApp.app).get(CUSTOMERS_PATH).query(query).set(bearer(adminToken));

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({
      code: 'CUSTOMER_INVALID_INPUT', message: 'List customers query is invalid',
    });
    expect(response.body.error.details.issues.length).toBeGreaterThan(0);
  });
});

describe('GET /api/v1/customers/:customerId', () => {
  it('denies DRIVER access and hides customers from another organization', async () => {
    const { testApp, adminToken, otherAdminToken, driverToken } =
      await seedActors();
    const created = await createCustomer(testApp, adminToken);
    const customerId = created.body.data.id as string;

    const own = await request(testApp.app)
      .get(`${CUSTOMERS_PATH}/${customerId}`)
      .set(bearer(driverToken));

    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe('AUTH_FORBIDDEN');

    const crossOrganization = await request(testApp.app)
      .get(`${CUSTOMERS_PATH}/${customerId}`)
      .set(bearer(otherAdminToken));

    expect(crossOrganization.status).toBe(404);
    expect(crossOrganization.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    expect(crossOrganization.body.error.message).toBe(
      `Customer ${customerId} was not found`,
    );
  });

  it('returns 404 for an unknown customer id', async () => {
    const { testApp, adminToken } = await seedActors();
    const unknownId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    const response = await request(testApp.app)
      .get(`${CUSTOMERS_PATH}/${unknownId}`)
      .set(bearer(adminToken));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('returns 400 for a malformed customer id', async () => {
    const { testApp, adminToken } = await seedActors();

    const response = await request(testApp.app)
      .get(`${CUSTOMERS_PATH}/not-a-uuid`)
      .set(bearer(adminToken));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('CUSTOMER_INVALID_INPUT');
    expect(response.body.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'customerId' }),
      ]),
    );
  });
});

describe('customers write surface', () => {
  it('does not expose update or delete routes', async () => {
    const { testApp, adminToken } = await seedActors();
    const created = await createCustomer(testApp, adminToken);
    const customerPath = `${CUSTOMERS_PATH}/${created.body.data.id}`;

    const update = await request(testApp.app)
      .patch(customerPath)
      .set(bearer(adminToken))
      .send({ name: 'Renamed Customer' });
    const remove = await request(testApp.app)
      .delete(customerPath)
      .set(bearer(adminToken));

    expect(update.status).toBe(404);
    expect(update.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(remove.status).toBe(404);
    expect(remove.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
