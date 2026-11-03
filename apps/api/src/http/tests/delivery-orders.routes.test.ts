import { createHash } from 'node:crypto';

import type { Express } from 'express';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type { DeliveryOrderRepository } from '../../modules/delivery-orders/application/ports/DeliveryOrderRepository.js';
import { DeliveryOrderInvariantError } from '../../modules/delivery-orders/domain/errors/DeliveryOrderError.js';
import {
  ADMIN_EMAIL,
  ADMIN_ID,
  DRIVER_ID,
  DRIVER_EMAIL,
  CUSTOMER_ID,
  OTHER_CUSTOMER_ID,
  DISPATCHER_ID,
  DISPATCHER_EMAIL,
  bearer,
  buildTestApp,
  createFailingRepository,
  CREATED_AT,
  FIRST_ORDER_ID,
  ORGANIZATION_ID,
  OTHER_ADMIN_EMAIL,
  OTHER_ADMIN_ID,
  OTHER_ORGANIZATION_ID,
  type TestAppOptions,
  validOrderBody,
} from './support/test-app.js';

const UNKNOWN_ORDER_ID = '99999999-9999-4999-8999-999999999999';

describe('POST /api/v1/delivery-orders/resolve-map-link', () => {
  it('returns coordinates for an allowlisted map URL with embedded coordinates', async () => {
    const { app, token } = await buildSeededApp();
    const response = await request(app)
      .post('/api/v1/delivery-orders/resolve-map-link')
      .set(bearer(token))
      .send({ url: 'https://www.google.com/maps/@-12.1,-77.02,15z' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { latitude: -12.1, longitude: -77.02 } });
  });
});

const IMPORT_HEADERS = [
  'customerCode', 'timeWindow', 'publicCode', 'recipientName', 'recipientPhone',
  'addressLine', 'district', 'latitude', 'longitude', 'packageCode',
  'packageDescription', 'packageWeightKg',
];

function importCsvRows(rows: readonly (readonly string[])[]): string {
  return [IMPORT_HEADERS.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

interface SeededApp {
  readonly app: Express;
  readonly token: string;
  readonly otherToken: string;
}

/** Two tenants, each with one ADMIN actor, and one bearer token per tenant. */
async function buildSeededApp(options: TestAppOptions = {}): Promise<SeededApp> {
  const testApp = buildTestApp({ ...options, seedTestCustomer: true });

  await testApp.seedOrganization({ id: ORGANIZATION_ID, name: 'Lima Express' });
  await testApp.seedOrganization({ id: OTHER_ORGANIZATION_ID, name: 'Callao Express' });

  const admin = await testApp.seedUser({
    id: ADMIN_ID,
    email: ADMIN_EMAIL,
    organizationId: ORGANIZATION_ID,
  });
  const otherAdmin = await testApp.seedUser({
    id: OTHER_ADMIN_ID,
    email: OTHER_ADMIN_EMAIL,
    organizationId: OTHER_ORGANIZATION_ID,
  });

  return {
    app: testApp.app,
    token: await testApp.signIn(admin),
    otherToken: await testApp.signIn(otherAdmin),
  };
}

async function createOrder(
  app: Express,
  token: string,
  body: Record<string, unknown> = validOrderBody(),
): Promise<string> {
  const response = await request(app)
    .post('/api/v1/delivery-orders')
    .set(bearer(token))
    .send(body);

  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

describe('POST /api/v1/delivery-orders', () => {
  it('allows dispatchers to create orders and rejects drivers without storing an order', async () => {
    const testApp = buildTestApp({ seedTestCustomer: true });
    await testApp.seedOrganization({ id: ORGANIZATION_ID, name: 'Lima Express' });
    const dispatcher = await testApp.seedUser({ id: DISPATCHER_ID, email: DISPATCHER_EMAIL, role: 'DISPATCHER' });
    const driver = await testApp.seedUser({ id: DRIVER_ID, email: DRIVER_EMAIL, role: 'DRIVER' });
    const driverToken = await testApp.signIn(driver);
    const dispatcherToken = await testApp.signIn(dispatcher);

    const denied = await request(testApp.app).post('/api/v1/delivery-orders').set(bearer(driverToken)).send(validOrderBody());
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('AUTH_FORBIDDEN');
    const lookup = await request(testApp.app).get('/api/v1/delivery-orders')
      .query({ publicCode: 'ORD-2026-0001' }).set(bearer(dispatcherToken));
    expect(lookup.status).toBe(404);
    const created = await request(testApp.app).post('/api/v1/delivery-orders').set(bearer(dispatcherToken)).send(validOrderBody());
    expect(created.status).toBe(201);
  });

  it('creates an order in the JWT organization and returns 201 with Location', async () => {
    const { app, token } = await buildSeededApp();

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(bearer(token))
      .send(validOrderBody());

    expect(response.status).toBe(201);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers.location).toBe(`/api/v1/delivery-orders/${FIRST_ORDER_ID}`);
    expect(response.body).toEqual({
      data: {
      id: FIRST_ORDER_ID,
      organizationId: ORGANIZATION_ID,
      customerId: CUSTOMER_ID,
        timeWindow: 'AM',
        publicCode: 'ORD-2026-0001',
        status: 'created',
        recipient: { name: 'Ana Torres', phone: '+51 987 654 321' },
        deliveryAddress: {
          addressLine: 'Av. Javier Prado Este 1234',
          district: 'San Borja',
          googleMapsUrl: null,
          latitude: -12.0975,
          longitude: -77.0023,
        },
        packages: [
          { code: 'PKG-001', description: 'Sealed box', weightKg: 2.5 },
          { code: 'PKG-002', description: 'Document envelope', weightKg: null },
        ],
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    });
  });

  it('requires an explicit AM/PM delivery window', async () => {
    const { app, token } = await buildSeededApp();
    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(bearer(token))
      .send(validOrderBody({ timeWindow: undefined }));

    expect(response.status).toBe(400);
    expect(response.body.error.details.issues).toContainEqual(
      expect.objectContaining({ path: 'timeWindow' }),
    );
  });

  it('returns 400 with field details and stores nothing when the body is invalid', async () => {
    const { app, token } = await buildSeededApp();

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(bearer(token))
      .send(
        validOrderBody({
          recipient: { name: 'Ana Torres', phone: 'not-a-phone' },
        }),
      );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DELIVERY_ORDER_INVALID_INPUT');
    expect(response.body.error.message).toBe(
      'Create delivery order request body is invalid',
    );
    expect(response.body.error.details.issues).toContainEqual({
      path: 'recipient.phone',
      message:
        'phone may contain digits, spaces, parentheses, hyphens and an optional leading +',
    });

    const lookup = await request(app)
      .get('/api/v1/delivery-orders')
      .query({ publicCode: 'ORD-2026-0001' })
      .set(bearer(token));

    expect(lookup.status).toBe(404);
  });

  it('requires a customer belonging to the authenticated organization', async () => {
    const { app, token } = await buildSeededApp();
    const missing = await request(app).post('/api/v1/delivery-orders')
      .set(bearer(token)).send(validOrderBody({ customerId: undefined }));
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('DELIVERY_ORDER_INVALID_INPUT');

    const foreign = await request(app).post('/api/v1/delivery-orders')
      .set(bearer(token)).send(validOrderBody({ customerId: OTHER_CUSTOMER_ID }));
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('CUSTOMER_NOT_FOUND');

    const lookup = await request(app).get('/api/v1/delivery-orders')
      .set(bearer(token)).query({ publicCode: 'ORD-2026-0001' });
    expect(lookup.status).toBe(404);
  });

  it('rejects an inactive customer without creating the delivery order', async () => {
    const testApp = buildTestApp({ seedTestCustomer: true, testCustomerStatus: 'inactive' });
    await testApp.seedOrganization();
    const admin = await testApp.seedUser();
    const response = await request(testApp.app).post('/api/v1/delivery-orders')
      .set(bearer(await testApp.signIn(admin))).send(validOrderBody());

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CUSTOMER_INACTIVE');
    expect(await testApp.module.repository.findByPublicCode(ORGANIZATION_ID, 'ORD-2026-0001'))
      .toBeNull();
  });

  it('rejects an organizationId in the body instead of trusting it', async () => {
    const { app, token } = await buildSeededApp();

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(bearer(token))
      .send(validOrderBody({ organizationId: OTHER_ORGANIZATION_ID }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DELIVERY_ORDER_INVALID_INPUT');
    expect(response.body.error.details.issues.length).toBeGreaterThan(0);
  });

  it('returns 401 and stores nothing when the access token is absent', async () => {
    const { app, token } = await buildSeededApp();

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .send(validOrderBody());

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_TOKEN_MISSING');
    expect(response.body.error.message).toBe(
      'The Authorization header with a Bearer access token is required',
    );

    const lookup = await request(app)
      .get('/api/v1/delivery-orders')
      .query({ publicCode: 'ORD-2026-0001' })
      .set(bearer(token));

    expect(lookup.status).toBe(404);
  });

  it('ignores a spoofed x-organization-id header: the verified token wins', async () => {
    const { app, token } = await buildSeededApp();

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(bearer(token))
      .set('x-organization-id', OTHER_ORGANIZATION_ID)
      .send(validOrderBody());

    expect(response.status).toBe(201);
    expect(response.body.data.organizationId).toBe(ORGANIZATION_ID);
  });

  it('returns 409 when the public code already exists in the organization', async () => {
    const { app, token } = await buildSeededApp();
    await createOrder(app, token);

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(bearer(token))
      .send(validOrderBody());

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('DELIVERY_ORDER_INVARIANT_VIOLATION');
    expect(response.body.error.details).toMatchObject({
      field: 'publicCode',
      publicCode: 'ORD-2026-0001',
    });
  });

  it('returns 409 when the adapter reports a duplicate public code during save', async () => {
    // The pre-check finds nothing, so the create reaches save. This simulates a
    // concurrent duplicate where the PostgreSQL constraint is the final guard;
    // the adapter translates 23505 into the same typed invariant error.
    let saveCalls = 0;
    const repository: DeliveryOrderRepository = {
      async nextCodes() {
        return { publicCode: 'ORD-00000001', packageCodes: ['PKG-00000001'] };
      },
      async save() {
        saveCalls += 1;
        throw new DeliveryOrderInvariantError(
          `Public code ORD-2026-0001 is already used in organization ${ORGANIZATION_ID}`,
          {
            field: 'publicCode',
            publicCode: 'ORD-2026-0001',
          },
        );
      },
      async findById() {
        return null;
      },
      async findByPublicCode() {
        return null;
      },
      async list() {
        return [];
      },
      async editDetails() {
        throw new Error('Unexpected edit');
      },
      async cancel() {
        throw new Error('Unexpected cancellation');
      },
      async findStatusHistory() {
        return [];
      },
    };

    const { app, token } = await buildSeededApp({ repository });

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(bearer(token))
      .send(validOrderBody());

    expect(saveCalls).toBe(1);
    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: 'DELIVERY_ORDER_INVARIANT_VIOLATION',
      message: `Public code ORD-2026-0001 is already used in organization ${ORGANIZATION_ID}`,
      details: {
        field: 'publicCode',
        publicCode: 'ORD-2026-0001',
      },
    });
    expect(response.body.error.correlationId).toBe(response.headers['x-request-id']);
  });

  it('returns a generic 500 when the repository fails', async () => {
    const { app, token } = await buildSeededApp({
      repository: createFailingRepository(),
    });

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(bearer(token))
      .send(validOrderBody());

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body.error.message).toBe(
      'An unexpected error occurred while processing the request',
    );
    expect(JSON.stringify(response.body)).not.toContain('database connection lost');
  });
});

describe('POST /api/v1/delivery-orders/import', () => {
  it('rejects invalid columns before writing any orders', async () => {
    const { app, token } = await buildSeededApp();

    const response = await request(app)
      .post('/api/v1/delivery-orders/import')
      .set(bearer(token))
      .set('Content-Type', 'text/csv')
      .send('wrongColumn,publicCode\nvalue,IMP-1');

    expect(response.status).toBe(400);
    const orders = await request(app).get('/api/v1/delivery-orders').set(bearer(token));
    expect(orders.body.data).toEqual([]);
  });

  it('imports valid order groups and rejects every row of a group with an invalid package', async () => {
    const { app, token } = await buildSeededApp();
    const response = await request(app)
      .post('/api/v1/delivery-orders/import')
      .set(bearer(token))
      .set('Content-Type', 'text/csv')
      .send(importCsvRows([
        ['TEST-CUSTOMER', 'AM', 'IMP-1', 'Ana Torres', '+51 987 654 321', 'Av. Javier Prado 100', 'San Borja', '', '', 'PKG-1', 'Caja', '2'],
        ['TEST-CUSTOMER', 'AM', 'IMP-1', 'Ana Torres', '+51 987 654 321', 'Av. Javier Prado 100', 'San Borja', '', '', 'PKG-2', '', ''],
        ['TEST-CUSTOMER', 'PM', 'IMP-2', 'Luis Soto', '+51 987 654 322', 'Jr. Los Olivos 55', 'Miraflores', '', '', 'PKG-3', 'Sobre', ''],
        ['TEST-CUSTOMER', 'PM', 'IMP-2', 'Luis Soto', '+51 987 654 322', 'Jr. Los Olivos 55', 'Miraflores', '', '', 'PKG-4', 'Caja', '1'],
      ]));

    expect(response.status).toBe(200);
    expect(response.body.data.importedOrders).toHaveLength(1);
    expect(response.body.data.importedOrders[0].publicCode).toBe('IMP-2');
    expect(response.body.data.rejectedOrders).toEqual([
      expect.objectContaining({ publicCode: 'IMP-1', rowNumbers: [2, 3] }),
    ]);
    const orders = await request(app).get('/api/v1/delivery-orders').set(bearer(token));
    expect(orders.body.data.map((order: { publicCode: string }) => order.publicCode)).toEqual(['IMP-2']);
    expect(orders.body.data[0].packages).toHaveLength(2);
  });

  it('imports XLSX workbooks and serves an XLSX template with the shared headers', async () => {
    const { app, token } = await buildSeededApp();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Orders');
    worksheet.addRow(IMPORT_HEADERS);
    worksheet.addRow([
      'TEST-CUSTOMER', 'PM', 'IMP-XLSX', 'Ana Torres', '+51 987 654 321',
      'Av. Javier Prado 100', 'San Borja', '', '', 'PKG-XLSX', 'Caja', 1.5,
    ]);
    const upload = Buffer.from(await workbook.xlsx.writeBuffer());
    const response = await request(app)
      .post('/api/v1/delivery-orders/import')
      .set(bearer(token))
      .set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .send(upload);

    expect(response.status).toBe(200);
    expect(response.body.data.importedOrders[0].publicCode).toBe('IMP-XLSX');

    const templateResponse = await request(app)
      .get('/api/v1/delivery-orders/import/template')
      .set(bearer(token))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(templateResponse.status).toBe(200);
    expect(templateResponse.headers['content-type']).toMatch(/spreadsheetml/);
    expect(templateResponse.headers['content-disposition']).toContain('delivery-orders-template.xlsx');
    expect(Buffer.isBuffer(templateResponse.body)).toBe(true);
    const template = new ExcelJS.Workbook();
    await template.xlsx.load(templateResponse.body as unknown as ArrayBuffer);
    expect((template.getWorksheet('Orders')?.getRow(1).values as unknown[]).slice(1)).toEqual([...IMPORT_HEADERS]);
  });

  it('does not resolve a customer code owned by another organization', async () => {
    const { app, token, otherToken } = await buildSeededApp();
    const foreignCustomer = await request(app)
      .post('/api/v1/customers')
      .set(bearer(otherToken))
      .send({
        publicCode: 'FOREIGN-CUSTOMER', name: 'Foreign Customer',
        contactName: 'Test Contact', contactEmail: 'foreign@example.test',
        contactPhone: '+51 900 000 002',
      });
    expect(foreignCustomer.status).toBe(201);

    const response = await request(app)
      .post('/api/v1/delivery-orders/import')
      .set(bearer(token))
      .set('Content-Type', 'text/csv')
      .send(importCsvRows([
        ['FOREIGN-CUSTOMER', 'AM', 'IMP-FOREIGN', 'Ana Torres', '+51 987 654 321', 'Av. Javier Prado 100', 'San Borja', '', '', 'PKG-1', 'Caja', ''],
      ]));

    expect(response.status).toBe(200);
    expect(response.body.data.importedOrders).toEqual([]);
    expect(response.body.data.rejectedOrders[0].issues).toContainEqual(
      expect.objectContaining({ field: 'customerCode', message: 'Customer code was not found in this organization.' }),
    );
    const orders = await request(app).get('/api/v1/delivery-orders').set(bearer(token));
    expect(orders.body.data).toEqual([]);
  });

  it('rejects rows for an inactive customer without creating an order', async () => {
    const testApp = buildTestApp({ seedTestCustomer: true, testCustomerStatus: 'inactive' });
    await testApp.seedOrganization({ id: ORGANIZATION_ID });
    const admin = await testApp.seedUser();
    const token = await testApp.signIn(admin);
    const response = await request(testApp.app)
      .post('/api/v1/delivery-orders/import')
      .set(bearer(token))
      .set('Content-Type', 'text/csv')
      .send(importCsvRows([
        ['TEST-CUSTOMER', 'AM', 'IMP-INACTIVE', 'Ana Torres', '+51 987 654 321', 'Av. Javier Prado 100', 'San Borja', '', '', 'PKG-1', 'Caja', ''],
      ]));

    expect(response.status).toBe(200);
    expect(response.body.data.importedOrders).toEqual([]);
    expect(response.body.data.rejectedOrders[0].issues).toContainEqual(
      expect.objectContaining({ field: 'customerCode', message: 'Customer is inactive.' }),
    );
    const orders = await request(testApp.app).get('/api/v1/delivery-orders').set(bearer(token));
    expect(orders.body.data).toEqual([]);
  });

  it('rejects DRIVER access before parsing an import body', async () => {
    const testApp = buildTestApp();
    await testApp.seedOrganization({ id: ORGANIZATION_ID });
    const driver = await testApp.seedUser({ id: DRIVER_ID, email: DRIVER_EMAIL, role: 'DRIVER' });
    const token = await testApp.signIn(driver);

    const response = await request(testApp.app)
      .post('/api/v1/delivery-orders/import')
      .set(bearer(token))
      .set('Content-Type', 'text/csv')
      .send('invalid,columns');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
  });
});

describe('POST /api/v1/delivery-orders/:orderId/cancel', () => {
  it('keeps the order and exposes its tenant-scoped cancellation history', async () => {
    const { app, token, otherToken } = await buildSeededApp();
    const orderId = await createOrder(app, token);
    // Regression probe from independent verification: both existing reads must
    // still return the same DTO before any new status command runs.
    const byIdBefore = await request(app)
      .get(`/api/v1/delivery-orders/${orderId}`).set(bearer(token));
    const byCodeBefore = await request(app)
      .get('/api/v1/delivery-orders')
      .query({ publicCode: 'ord-2026-0001' }).set(bearer(token));
    expect(byIdBefore.status).toBe(200);
    expect(byCodeBefore.status).toBe(200);
    expect(byCodeBefore.body).toEqual(byIdBefore.body);

    const cancelled = await request(app)
      .post(`/api/v1/delivery-orders/${orderId}/cancel`)
      .set(bearer(token));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({ id: orderId, status: 'cancelled' });
    expect(cancelled.body.data.updatedAt).toBe(CREATED_AT);

    const order = await request(app).get(`/api/v1/delivery-orders/${orderId}`).set(bearer(token));
    expect(order.status).toBe(200);
    expect(order.body.data).toEqual(cancelled.body.data);

    const history = await request(app)
      .get(`/api/v1/delivery-orders/${orderId}/history`)
      .set(bearer(token));
    expect(history.status).toBe(200);
    expect(history.body.data).toEqual([
      { fromStatus: 'created', toStatus: 'cancelled', actorUserId: ADMIN_ID, occurredAt: CREATED_AT },
    ]);

    const foreignHistory = await request(app)
      .get(`/api/v1/delivery-orders/${orderId}/history`)
      .set(bearer(otherToken));
    expect(foreignHistory.status).toBe(404);
    expect(foreignHistory.body.error.code).toBe('DELIVERY_ORDER_NOT_FOUND');
  });

  it('rejects a foreign or repeated cancellation without changing order or history', async () => {
    const { app, token, otherToken } = await buildSeededApp();
    const orderId = await createOrder(app, token);

    const foreign = await request(app)
      .post(`/api/v1/delivery-orders/${orderId}/cancel`)
      .set(bearer(otherToken));
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('DELIVERY_ORDER_NOT_FOUND');

    const before = await request(app).get(`/api/v1/delivery-orders/${orderId}`).set(bearer(token));
    expect(before.body.data.status).toBe('created');
    const beforeHistory = await request(app)
      .get(`/api/v1/delivery-orders/${orderId}/history`)
      .set(bearer(token));
    expect(beforeHistory.body.data).toEqual([]);

    const first = await request(app)
      .post(`/api/v1/delivery-orders/${orderId}/cancel`)
      .set(bearer(token));
    expect(first.status).toBe(200);
    const repeated = await request(app)
      .post(`/api/v1/delivery-orders/${orderId}/cancel`)
      .set(bearer(token));
    expect(repeated.status).toBe(409);
    expect(repeated.body.error.code).toBe('DELIVERY_ORDER_INVARIANT_VIOLATION');
    const after = await request(app).get(`/api/v1/delivery-orders/${orderId}`).set(bearer(token));
    expect(after.body.data).toEqual(first.body.data);
    const history = await request(app)
      .get(`/api/v1/delivery-orders/${orderId}/history`)
      .set(bearer(token));
    expect(history.body.data).toHaveLength(1);
  });

  it('requires authentication and a valid order id', async () => {
    const { app, token } = await buildSeededApp();
    const missingToken = await request(app).post(`/api/v1/delivery-orders/${UNKNOWN_ORDER_ID}/cancel`);
    expect(missingToken.status).toBe(401);
    expect(missingToken.body.error.code).toBe('AUTH_TOKEN_MISSING');
    const malformed = await request(app)
      .post('/api/v1/delivery-orders/not-an-id/cancel')
      .set(bearer(token));
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('DELIVERY_ORDER_INVALID_INPUT');
  });

  it('rejects a spoofed tenant body and forbids a DRIVER without changing status or audit', async () => {
    const testApp = buildTestApp({ seedTestCustomer: true });
    await testApp.seedOrganization();
    const admin = await testApp.seedUser();
    const driver = await testApp.seedUser({
      id: DRIVER_ID, email: DRIVER_EMAIL, role: 'DRIVER',
    });
    const adminToken = await testApp.signIn(admin);
    const driverToken = await testApp.signIn(driver);
    const orderId = await createOrder(testApp.app, adminToken);

    const spoofed = await request(testApp.app)
      .post(`/api/v1/delivery-orders/${orderId}/cancel`)
      .set(bearer(adminToken))
      .send({ organizationId: OTHER_ORGANIZATION_ID });
    expect(spoofed.status).toBe(400);
    expect(spoofed.body.error.code).toBe('DELIVERY_ORDER_INVALID_INPUT');

    const forbidden = await request(testApp.app)
      .post(`/api/v1/delivery-orders/${orderId}/cancel`)
      .set(bearer(driverToken));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('AUTH_FORBIDDEN');

    const order = await request(testApp.app).get(`/api/v1/delivery-orders/${orderId}`).set(bearer(adminToken));
    expect(order.body.data.status).toBe('created');
    const history = await request(testApp.app)
      .get(`/api/v1/delivery-orders/${orderId}/history`)
      .set(bearer(adminToken));
    expect(history.body.data).toEqual([]);
  });
});

describe('GET /api/v1/delivery-orders/{orderId}', () => {
  it('returns 200 with the stored order', async () => {
    const { app, token } = await buildSeededApp();
    const orderId = await createOrder(app, token);

    const response = await request(app)
      .get(`/api/v1/delivery-orders/${orderId}`)
      .set(bearer(token));

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(orderId);
    expect(response.body.data.publicCode).toBe('ORD-2026-0001');
    expect(response.body.data.createdAt).toBe(CREATED_AT);
  });

  it('returns 400 with field details for a malformed order id', async () => {
    const { app, token } = await buildSeededApp();

    const response = await request(app)
      .get('/api/v1/delivery-orders/not-a-uuid')
      .set(bearer(token));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DELIVERY_ORDER_INVALID_INPUT');
    expect(response.body.error.details.issues).toContainEqual(
      expect.objectContaining({ path: 'orderId' }),
    );
  });

  it('returns 404 for an unknown order id', async () => {
    const { app, token } = await buildSeededApp();

    const response = await request(app)
      .get(`/api/v1/delivery-orders/${UNKNOWN_ORDER_ID}`)
      .set(bearer(token));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('DELIVERY_ORDER_NOT_FOUND');
    expect(response.body.error.message).toBe(
      `Delivery order ${UNKNOWN_ORDER_ID} was not found`,
    );
    expect(response.body.error.details).toBeUndefined();
  });

  it('returns 404 with the same envelope as an unknown id for another tenant token', async () => {
    const { app, token, otherToken } = await buildSeededApp();
    const orderId = await createOrder(app, token);

    const forbidden = await request(app)
      .get(`/api/v1/delivery-orders/${orderId}`)
      .set(bearer(otherToken));
    const ownerRead = await request(app)
      .get(`/api/v1/delivery-orders/${orderId}`)
      .set(bearer(token));

    expect(forbidden.status).toBe(404);
    expect(forbidden.body.error.code).toBe('DELIVERY_ORDER_NOT_FOUND');
    expect(forbidden.body.error.message).toBe(
      `Delivery order ${orderId} was not found`,
    );
    expect(forbidden.body.error.details).toBeUndefined();

    // The store contains the order for the owning organization, so the 200
    // proves the 404 is a disclosure decision, not a storage failure.
    expect(ownerRead.status).toBe(200);
  });

  it('returns a generic 500 when the repository read fails', async () => {
    const { app, token } = await buildSeededApp({
      repository: createFailingRepository(),
    });

    const response = await request(app)
      .get(`/api/v1/delivery-orders/${UNKNOWN_ORDER_ID}`)
      .set(bearer(token));

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('database connection lost');
  });
});

describe('GET /api/v1/delivery-orders?publicCode=...', () => {
  it('denies DRIVER access to the general order catalog and history endpoints', async () => {
    const testApp = buildTestApp({ seedTestCustomer: true });
    await testApp.seedOrganization();
    const driver = await testApp.seedUser({ id: DRIVER_ID, email: DRIVER_EMAIL, role: 'DRIVER' });
    const token = await testApp.signIn(driver);
    const orderPath = `/api/v1/delivery-orders/${FIRST_ORDER_ID}`;
    const responses = await Promise.all([
      request(testApp.app).get('/api/v1/delivery-orders').set(bearer(token)),
      request(testApp.app).get('/api/v1/delivery-orders').query({ publicCode: 'ORD-2026-0001' }).set(bearer(token)),
      request(testApp.app).get(orderPath).set(bearer(token)),
      request(testApp.app).get(`${orderPath}/history`).set(bearer(token)),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    }
  });

  it('returns 200 for a code in the caller organization', async () => {
    const { app, token } = await buildSeededApp();
    const orderId = await createOrder(app, token);

    const response = await request(app)
      .get('/api/v1/delivery-orders')
      .query({ publicCode: 'ord-2026-0001' })
      .set(bearer(token));

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(orderId);
    expect(response.body.data.publicCode).toBe('ORD-2026-0001');
  });

  it('returns 404 for a code owned by another organization', async () => {
    const { app, token, otherToken } = await buildSeededApp();
    await createOrder(app, token);

    const response = await request(app)
      .get('/api/v1/delivery-orders')
      .query({ publicCode: 'ORD-2026-0001' })
      .set(bearer(otherToken));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('DELIVERY_ORDER_NOT_FOUND');
  });

  it('lists only the caller organization orders with the existing order DTO shape', async () => {
    const { app, token, otherToken } = await buildSeededApp();
    const firstId = await createOrder(app, token);
    const secondId = await createOrder(app, token, validOrderBody({ publicCode: 'ord-2026-0002' }));
    await createOrder(app, otherToken, validOrderBody({ customerId: OTHER_CUSTOMER_ID, publicCode: 'ord-2026-0001' }));

    const response = await request(app).get('/api/v1/delivery-orders').set(bearer(token));
    expect(response.status).toBe(200);
    const first = await request(app).get(`/api/v1/delivery-orders/${firstId}`).set(bearer(token));
    const second = await request(app).get(`/api/v1/delivery-orders/${secondId}`).set(bearer(token));
    const sorted = [first.body.data, second.body.data].sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
    expect(response.body).toEqual({ data: sorted });
    expect(response.body.data.map((order: { id: string }) => order.id)).toEqual(sorted.map((order) => order.id));

    const foreignList = await request(app).get('/api/v1/delivery-orders').set(bearer(otherToken));
    expect(foreignList.status).toBe(200);
    expect(foreignList.body.data).toHaveLength(1);
    expect(foreignList.body.data[0].organizationId).toBe(OTHER_ORGANIZATION_ID);
  });

  it('returns an empty list for a new organization and rejects unrecognized filters', async () => {
    const { app, token } = await buildSeededApp();
    const empty = await request(app).get('/api/v1/delivery-orders').set(bearer(token));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ data: [] });

    const invalid = await request(app)
      .get('/api/v1/delivery-orders').query({ unknown: 'value' }).set(bearer(token));
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('DELIVERY_ORDER_INVALID_INPUT');
    const missingToken = await request(app).get('/api/v1/delivery-orders');
    expect(missingToken.status).toBe(401);
    expect(missingToken.body.error.code).toBe('AUTH_TOKEN_MISSING');
  });

  it('leaves the order and history unchanged after rejected filters and foreign reads', async () => {
    const { app, token, otherToken } = await buildSeededApp();
    const orderId = await createOrder(app, token);
    const snapshot = async () => {
      const order = await request(app).get(`/api/v1/delivery-orders/${orderId}`).set(bearer(token));
      const history = await request(app).get(`/api/v1/delivery-orders/${orderId}/history`).set(bearer(token));
      expect(order.status).toBe(200);
      expect(history.status).toBe(200);
      return createHash('sha256').update(JSON.stringify({ order: order.body, history: history.body })).digest('hex');
    };
    const before = await snapshot();

    const invalid = await request(app)
      .get('/api/v1/delivery-orders').query({ unknown: 'value' }).set(bearer(token));
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.message).toBe('List delivery orders query is invalid');
    const foreign = await request(app).get(`/api/v1/delivery-orders/${orderId}`).set(bearer(otherToken));
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('DELIVERY_ORDER_NOT_FOUND');
    expect(await snapshot()).toBe(before);
  });
});

describe('PATCH /api/v1/delivery-orders/:orderId', () => {
  it('rejects DRIVER edits without changing the order or history', async () => {
    const testApp = buildTestApp({ seedTestCustomer: true });
    await testApp.seedOrganization();
    const admin = await testApp.seedUser();
    const driver = await testApp.seedUser({ id: DRIVER_ID, email: DRIVER_EMAIL, role: 'DRIVER' });
    const adminToken = await testApp.signIn(admin);
    const driverToken = await testApp.signIn(driver);
    const id = await createOrder(testApp.app, adminToken);
    const path = `/api/v1/delivery-orders/${id}`;
    const before = await request(testApp.app).get(path).set(bearer(adminToken));
    const history = await request(testApp.app).get(`${path}/history`).set(bearer(adminToken));
    const denied = await request(testApp.app).patch(path).set(bearer(driverToken))
      .send({ recipient: { name: 'No', phone: '+51 999 888 777' } });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('AUTH_FORBIDDEN');
    expect((await request(testApp.app).get(path).set(bearer(adminToken))).body).toEqual(before.body);
    expect((await request(testApp.app).get(`${path}/history`).set(bearer(adminToken))).body)
      .toEqual(history.body);
  });

  it('rejects immutable fields and duplicate packages without writes', async () => {
    const { app, token } = await buildSeededApp();
    const id = await createOrder(app, token);
    const path = `/api/v1/delivery-orders/${id}`;
    const before = await request(app).get(path).set(bearer(token));
    const history = await request(app).get(`${path}/history`).set(bearer(token));
    for (const immutable of [
      { id: UNKNOWN_ORDER_ID },
      { organizationId: OTHER_ORGANIZATION_ID },
      { publicCode: 'OTHER-001' },
      { status: 'planned' },
      { createdAt: '2026-10-27T00:00:00.000Z' },
    ]) {
      const rejected = await request(app).patch(path).set(bearer(token))
        .send({ recipient: { name: 'No', phone: '+51 999 888 777' }, ...immutable });
      expect(rejected.status).toBe(400);
      expect(rejected.body.error.message).toBe('Edit delivery order request body is invalid');
    }
    const duplicate = await request(app).patch(path).set(bearer(token)).send({
      packages: [
        { code: 'DUP-1', description: 'One' },
        { code: 'DUP-1', description: 'Two' },
      ],
    });
    expect(duplicate.status).toBe(409);
    expect((await request(app).get(path).set(bearer(token))).body).toEqual(before.body);
    expect((await request(app).get(`${path}/history`).set(bearer(token))).body)
      .toEqual(history.body);
  });

  it('edits order-owned details only while created and keeps identity, status and history', async () => {
    const { app, token } = await buildSeededApp();
    const id = await createOrder(app, token);
    const original = await request(app).get(`/api/v1/delivery-orders/${id}`).set(bearer(token));
    const changes = {
      recipient: { name: 'New Recipient', phone: '+51 999 888 777' },
      deliveryAddress: { addressLine: 'Av. Arequipa 987', district: 'Lince' },
      packages: [{ code: 'NEW-001', description: 'Replacement parcel' }],
    };
    const changed = await request(app).patch(`/api/v1/delivery-orders/${id}`)
      .set(bearer(token)).send(changes);
    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({
      id, organizationId: ORGANIZATION_ID, publicCode: original.body.data.publicCode,
      status: 'created', recipient: changes.recipient,
      deliveryAddress: { ...changes.deliveryAddress, latitude: null, longitude: null },
      packages: [{ ...changes.packages[0], weightKg: null }],
      createdAt: original.body.data.createdAt,
    });
    expect(Date.parse(changed.body.data.updatedAt)).toBeGreaterThanOrEqual(Date.parse(original.body.data.updatedAt));
    const read = await request(app).get(`/api/v1/delivery-orders/${id}`).set(bearer(token));
    expect(read.body).toEqual(changed.body);
    const recipientOnly = await request(app).patch(`/api/v1/delivery-orders/${id}`)
      .set(bearer(token)).send({ recipient: { name: 'Final Recipient', phone: '+51 999 888 777' } });
    expect(recipientOnly.status).toBe(200);
    expect(recipientOnly.body.data).toEqual({ ...changed.body.data,
      recipient: { name: 'Final Recipient', phone: '+51 999 888 777' },
    });
    const history = await request(app).get(`/api/v1/delivery-orders/${id}/history`).set(bearer(token));
    expect(history.status).toBe(200);
    expect(history.body).toEqual({ data: [] });
  });

  it('rejects edits after cancellation, foreign edits and invalid fields without changing the order', async () => {
    const { app, token, otherToken } = await buildSeededApp();
    const id = await createOrder(app, token);
    const route = `/api/v1/delivery-orders/${id}`;
    const original = await request(app).get(route).set(bearer(token));
    const foreign = await request(app).patch(route).set(bearer(otherToken))
      .send({ recipient: { name: 'Wrong Tenant', phone: '+51 987 654 321' } });
    expect(foreign.status).toBe(404);
    const invalid = await request(app).patch(route).set(bearer(token))
      .send({ publicCode: 'CHANGED' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('DELIVERY_ORDER_INVALID_INPUT');
    const empty = await request(app).patch(route).set(bearer(token)).send({});
    expect(empty.status).toBe(400);
    const missingToken = await request(app).patch(route).send({ recipient: { name: 'No Token', phone: '+51 987 654 321' } });
    expect(missingToken.status).toBe(401);
    const after = await request(app).get(route).set(bearer(token));
    expect(after.body).toEqual(original.body);

    const cancelled = await request(app).post(`${route}/cancel`).set(bearer(token)).send({});
    expect(cancelled.status).toBe(200);
    const rejected = await request(app).patch(route).set(bearer(token))
      .send({ recipient: { name: 'Too Late', phone: '+51 987 654 321' } });
    expect(rejected.status).toBe(409);
    const afterCancel = await request(app).get(route).set(bearer(token));
    expect(afterCancel.body).toEqual(cancelled.body);
  });
});
