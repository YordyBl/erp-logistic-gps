import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type { DeliveryOrderRepository } from '../../modules/delivery-orders/application/ports/DeliveryOrderRepository.js';
import { DeliveryOrderInvariantError } from '../../modules/delivery-orders/domain/errors/DeliveryOrderError.js';
import {
  buildTestApp,
  createFailingRepository,
  CREATED_AT,
  FIRST_ORDER_ID,
  ORGANIZATION_HEADER,
  ORGANIZATION_ID,
  OTHER_ORGANIZATION_ID,
  validOrderBody,
} from './support/test-app.js';

const UNKNOWN_ORDER_ID = '99999999-9999-4999-8999-999999999999';

async function createOrder(
  app: Express,
  organizationId = ORGANIZATION_ID,
  body: Record<string, unknown> = validOrderBody(),
): Promise<string> {
  const response = await request(app)
    .post('/api/v1/delivery-orders')
    .set(ORGANIZATION_HEADER, organizationId)
    .send(body);

  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

describe('POST /api/v1/delivery-orders', () => {
  it('creates an order and returns 201 with the full resource and Location header', async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID)
      .send(validOrderBody());

    expect(response.status).toBe(201);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers.location).toBe(`/api/v1/delivery-orders/${FIRST_ORDER_ID}`);
    expect(response.body).toEqual({
      data: {
        id: FIRST_ORDER_ID,
        organizationId: ORGANIZATION_ID,
        publicCode: 'ORD-2026-0001',
        status: 'created',
        recipient: { name: 'Ana Torres', phone: '+51 987 654 321' },
        deliveryAddress: {
          addressLine: 'Av. Javier Prado Este 1234',
          district: 'San Borja',
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

  it('returns 400 with field details and stores nothing when the body is invalid', async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID)
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
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID);

    expect(lookup.status).toBe(404);
  });

  it('rejects an organizationId in the body instead of trusting it', async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID)
      .send(validOrderBody({ organizationId: OTHER_ORGANIZATION_ID }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DELIVERY_ORDER_INVALID_INPUT');
    expect(response.body.error.details.issues.length).toBeGreaterThan(0);
  });

  it('returns 401 and stores nothing when the organization header is absent', async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .send(validOrderBody());

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('ORGANIZATION_REQUIRED');
    expect(response.body.error.message).toBe(
      'The x-organization-id header is required',
    );

    const lookup = await request(app)
      .get('/api/v1/delivery-orders')
      .query({ publicCode: 'ORD-2026-0001' })
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID);

    expect(lookup.status).toBe(404);
  });

  it('returns 401 for a malformed organization header', async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(ORGANIZATION_HEADER, 'not-a-uuid')
      .send(validOrderBody());

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('ORGANIZATION_INVALID');
  });

  it('returns 409 when the public code already exists in the organization', async () => {
    const { app } = buildTestApp();
    await createOrder(app);

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID)
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
    };

    const { app } = buildTestApp({ repository });

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID)
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
    const { app } = buildTestApp({ repository: createFailingRepository() });

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID)
      .send(validOrderBody());

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body.error.message).toBe(
      'An unexpected error occurred while processing the request',
    );
    expect(JSON.stringify(response.body)).not.toContain('database connection lost');
  });
});

describe('GET /api/v1/delivery-orders/{orderId}', () => {
  it('returns 200 with the stored order', async () => {
    const { app } = buildTestApp();
    const orderId = await createOrder(app);

    const response = await request(app)
      .get(`/api/v1/delivery-orders/${orderId}`)
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(orderId);
    expect(response.body.data.publicCode).toBe('ORD-2026-0001');
    expect(response.body.data.createdAt).toBe(CREATED_AT);
  });

  it('returns 400 with field details for a malformed order id', async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .get('/api/v1/delivery-orders/not-a-uuid')
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DELIVERY_ORDER_INVALID_INPUT');
    expect(response.body.error.details.issues).toContainEqual(
      expect.objectContaining({ path: 'orderId' }),
    );
  });

  it('returns 404 for an unknown order id', async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .get(`/api/v1/delivery-orders/${UNKNOWN_ORDER_ID}`)
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('DELIVERY_ORDER_NOT_FOUND');
    expect(response.body.error.message).toBe(
      `Delivery order ${UNKNOWN_ORDER_ID} was not found`,
    );
    expect(response.body.error.details).toBeUndefined();
  });

  it('returns 404 with the same envelope as an unknown id for a cross-organization read', async () => {
    const { app } = buildTestApp();
    const orderId = await createOrder(app, ORGANIZATION_ID);

    const forbidden = await request(app)
      .get(`/api/v1/delivery-orders/${orderId}`)
      .set(ORGANIZATION_HEADER, OTHER_ORGANIZATION_ID);
    const ownerRead = await request(app)
      .get(`/api/v1/delivery-orders/${orderId}`)
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID);

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
    const { app } = buildTestApp({ repository: createFailingRepository() });

    const response = await request(app)
      .get(`/api/v1/delivery-orders/${UNKNOWN_ORDER_ID}`)
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID);

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('database connection lost');
  });
});

describe('GET /api/v1/delivery-orders?publicCode=...', () => {
  it('returns 200 for a code in the caller organization', async () => {
    const { app } = buildTestApp();
    const orderId = await createOrder(app);

    const response = await request(app)
      .get('/api/v1/delivery-orders')
      .query({ publicCode: 'ord-2026-0001' })
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(orderId);
    expect(response.body.data.publicCode).toBe('ORD-2026-0001');
  });

  it('returns 404 for a code owned by another organization', async () => {
    const { app } = buildTestApp();
    await createOrder(app, ORGANIZATION_ID);

    const response = await request(app)
      .get('/api/v1/delivery-orders')
      .query({ publicCode: 'ORD-2026-0001' })
      .set(ORGANIZATION_HEADER, OTHER_ORGANIZATION_ID);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('DELIVERY_ORDER_NOT_FOUND');
  });

  it('returns 400 when publicCode is missing', async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .get('/api/v1/delivery-orders')
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DELIVERY_ORDER_INVALID_INPUT');
    expect(response.body.error.details.issues).toContainEqual(
      expect.objectContaining({ path: 'publicCode' }),
    );
  });
});
