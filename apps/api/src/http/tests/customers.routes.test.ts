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
    expect(response.body.error.code).toBe('CUSTOMER_INVALID_INPUT');
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
  it('lists only the caller organization customers for a DRIVER', async () => {
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

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(
      response.body.data.every(
        (customer: { organizationId: string }) =>
          customer.organizationId === ORGANIZATION_ID,
      ),
    ).toBe(true);
  });

  it('returns 401 without a token', async () => {
    const { testApp } = await seedActors();

    const response = await request(testApp.app).get(CUSTOMERS_PATH);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_TOKEN_MISSING');
  });
});

describe('GET /api/v1/customers/:customerId', () => {
  it('returns one customer to a DRIVER and hides it from another organization', async () => {
    const { testApp, adminToken, otherAdminToken, driverToken } =
      await seedActors();
    const created = await createCustomer(testApp, adminToken);
    const customerId = created.body.data.id as string;

    const own = await request(testApp.app)
      .get(`${CUSTOMERS_PATH}/${customerId}`)
      .set(bearer(driverToken));

    expect(own.status).toBe(200);
    expect(own.body.data.id).toBe(customerId);

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
