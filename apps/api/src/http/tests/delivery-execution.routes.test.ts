import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import type {
  DeliveryEvidence,
  DeliveryEvidenceStore,
  EvidenceUploadReservation,
  EvidenceVaultCriteria,
  EvidenceVaultItem,
} from '../../modules/delivery-execution/application/ports/DeliveryEvidenceStore.js';
import type { EvidenceObjectStorage } from '../../modules/delivery-execution/application/ports/EvidenceObjectStorage.js';
import { pageOffset, type PageResult } from '../pagination.js';
import { createDeliveryExecutionModule } from '../../modules/delivery-execution/composition/composition-root.js';
import { createErrorHandler } from '../middleware/error-handler.js';
import { setAuthenticatedUser, type AuthenticatedUser } from '../request-context.js';
import { createDeliveryExecutionRouter } from '../routes/delivery-execution.routes.js';
import { VALID_JPEG } from '../../modules/delivery-execution/tests/evidence-fixtures.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';
const ATTEMPT = '44444444-4444-4444-8444-444444444444';
const EVIDENCE = '55555555-5555-4555-8555-555555555555';
const AT = '2026-10-29T12:00:00.000Z';
const JPEG = VALID_JPEG;
const ACTOR = '33333333-3333-4333-8333-333333333333';
const OTHER_ORG = '66666666-6666-4666-8666-666666666666';

function vaultItem(index: number, overrides: Partial<EvidenceVaultItem> = {}): EvidenceVaultItem {
  const suffix = String(index).padStart(12, '0');
  const orderId = `00000000-0000-4000-8000-${suffix}`;
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`,
    organizationId: ORG,
    orderId,
    attemptId: ATTEMPT,
    incidentId: null,
    mimeType: 'image/jpeg',
    byteSize: 100,
    checksum: 'a'.repeat(64),
    uploadedBy: ACTOR,
    status: 'available',
    createdAt: new Date(Date.UTC(2026, 9, 1, 12, index)).toISOString(),
    availableAt: AT,
    order: {
      id: orderId,
      publicCode: `ORD-${String(index).padStart(8, '0')}`,
      status: 'delivered',
      recipientName: `Cliente ${index}`,
      district: 'Lince',
    },
    ...overrides,
  };
}

class TestEvidenceStore implements DeliveryEvidenceStore {
  private record: EvidenceUploadReservation | undefined;
  readonly vaultCalls: { organizationId: string; criteria: EvidenceVaultCriteria }[] = [];

  constructor(private readonly vault: readonly EvidenceVaultItem[] = []) {}

  /** Same semantics as the TypeORM store: tenant scope, filters, newest first, then the page slice. */
  async listVaultPage(
    organizationId: string,
    criteria: EvidenceVaultCriteria,
  ): Promise<PageResult<EvidenceVaultItem>> {
    this.vaultCalls.push({ organizationId, criteria });
    const q = criteria.q?.toLowerCase();
    const matching = this.vault
      .filter((item) => item.organizationId === organizationId)
      .filter((item) => criteria.orderId === undefined || item.orderId === criteria.orderId)
      .filter((item) => q === undefined || item.order.publicCode.toLowerCase().includes(q) ||
        item.order.recipientName.toLowerCase().includes(q))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    const start = pageOffset(criteria);
    return { items: matching.slice(start, start + criteria.pageSize), total: matching.length };
  }

  async reserveUpload(input: Parameters<DeliveryEvidenceStore['reserveUpload']>[0]) {
    this.record ??= {
      id: EVIDENCE,
      organizationId: input.organizationId,
      orderId: input.orderId,
      attemptId: ATTEMPT,
      incidentId: null,
      objectKey: 'private/object-key',
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      checksum: input.checksum,
      uploadedBy: input.actorUserId,
      status: 'pending_upload',
      createdAt: AT,
      availableAt: null,
    };
    return this.record;
  }

  async markAvailable(): Promise<DeliveryEvidence> {
    if (this.record === undefined) throw new Error('missing reservation');
    this.record = { ...this.record, status: 'available', availableAt: AT };
    return this.record;
  }

  async listForOrder(): Promise<readonly DeliveryEvidence[]> {
    return this.record === undefined ? [] : [this.record];
  }

  async findForDownload(): Promise<EvidenceUploadReservation> {
    if (this.record === undefined) throw new Error('missing evidence');
    return { ...this.record, status: 'available', availableAt: AT };
  }
}

function testApp(
  role: AuthenticatedUser['role'] = 'DRIVER',
  store: TestEvidenceStore = new TestEvidenceStore(),
  organizationId: string = ORG,
) {
  const actor: AuthenticatedUser = {
    id: ACTOR,
    organizationId,
    email: 'actor@example.test',
    role,
  };
  const objects = new Map<string, Buffer>();
  const objectStorage: EvidenceObjectStorage = {
    put: async (key, bytes) => { objects.set(key, Buffer.from(bytes)); },
    get: async (key) => {
      const bytes = objects.get(key);
      if (bytes === undefined) throw new Error('not found');
      return bytes;
    },
  };
  const module = createDeliveryExecutionModule({
    store,
    objectStorage,
    clock: { now: () => AT },
  });
  const app = express();
  app.use('/api/v1', createDeliveryExecutionRouter(module, (_request, response, next) => {
    setAuthenticatedUser(response, actor);
    next();
  }));
  app.use(createErrorHandler(pino({ level: 'silent' })));
  return app;
}

describe('delivery execution evidence HTTP', () => {
  it('uploads one raw photo and returns metadata without a storage key', async () => {
    const response = await request(testApp()).post(`/api/v1/delivery-orders/${ORDER}/evidence`)
      .set('Content-Type', 'image/jpeg')
      .set('Idempotency-Key', 'attempt-photo-1')
      .send(JPEG);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      id: EVIDENCE, orderId: ORDER, attemptId: ATTEMPT, mimeType: 'image/jpeg', status: 'available',
    });
    expect(response.body.data).not.toHaveProperty('objectKey');
  });

  it('requires the idempotency key and rejects unsupported upload types', async () => {
    const app = testApp();
    const missingKey = await request(app).post(`/api/v1/delivery-orders/${ORDER}/evidence`)
      .set('Content-Type', 'image/jpeg').send(JPEG);
    const unsupported = await request(app).post(`/api/v1/delivery-orders/${ORDER}/evidence`)
      .set('Content-Type', 'application/octet-stream')
      .set('Idempotency-Key', 'attempt-photo-2').send(JPEG);

    expect(missingKey.status).toBe(400);
    expect(unsupported.status).toBe(400);
  });

  it('returns a validation response for malformed image bytes', async () => {
    const malformedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const response = await request(testApp()).post(`/api/v1/delivery-orders/${ORDER}/evidence`)
      .set('Content-Type', 'image/png')
      .set('Idempotency-Key', 'attempt-malformed-png')
      .send(malformedPng);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DELIVERY_EVIDENCE_INVALID_INPUT');
  });

  it('rejects uploads over the transport limit before application handling', async () => {
    const oversized = Buffer.alloc(5_000_001);
    oversized.set([0xff, 0xd8, 0xff, 0xd9]);
    const response = await request(testApp()).post(`/api/v1/delivery-orders/${ORDER}/evidence`)
      .set('Content-Type', 'image/jpeg')
      .set('Idempotency-Key', 'attempt-photo-3')
      .send(oversized);

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('limits uploads to DRIVER and serves evidence privately with integrity checks', async () => {
    const forbidden = await request(testApp('ADMIN'))
      .post(`/api/v1/delivery-orders/${ORDER}/evidence`)
      .set('Content-Type', 'image/jpeg').set('Idempotency-Key', 'attempt-photo-4').send(JPEG);
    const app = testApp();
    const uploaded = await request(app).post(`/api/v1/delivery-orders/${ORDER}/evidence`)
      .set('Content-Type', 'image/jpeg').set('Idempotency-Key', 'attempt-photo-5').send(JPEG);
    const downloaded = await request(app).get(`/api/v1/evidence/${EVIDENCE}/download`);

    expect(forbidden.status).toBe(403);
    expect(uploaded.status).toBe(201);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers['cache-control']).toBe('private, no-store');
    expect(downloaded.headers['x-content-type-options']).toBe('nosniff');
    expect(createHash('sha256').update(downloaded.body).digest('hex')).toBe(uploaded.body.data.checksum);
  });
});

describe('GET /delivery-evidence (evidence vault)', () => {
  const items = [
    ...Array.from({ length: 12 }, (_, index) => vaultItem(index + 1)),
    vaultItem(50, { organizationId: OTHER_ORG, order: { ...vaultItem(50).order, publicCode: 'ORD-OTRA-ORG' } }),
  ];

  it('returns one page newest first with meta and the compact order', async () => {
    const store = new TestEvidenceStore(items);
    const response = await request(testApp('DISPATCHER', store)).get('/api/v1/delivery-evidence?pageSize=5&page=2');

    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({ page: 2, pageSize: 5, total: 12 });
    expect(response.body.data.map((item: { order: { publicCode: string } }) => item.order.publicCode))
      .toEqual(['ORD-00000007', 'ORD-00000006', 'ORD-00000005', 'ORD-00000004', 'ORD-00000003']);
    const seventh = vaultItem(7);
    expect(response.body.data[0]).toEqual({
      id: seventh.id, orderId: seventh.orderId, attemptId: ATTEMPT, incidentId: null,
      mimeType: 'image/jpeg', byteSize: 100, checksum: 'a'.repeat(64), uploadedBy: ACTOR,
      status: 'available', createdAt: seventh.createdAt, availableAt: AT,
      order: { id: seventh.orderId, publicCode: 'ORD-00000007', status: 'delivered', recipientName: 'Cliente 7', district: 'Lince' },
    });
    expect(store.vaultCalls).toEqual([{ organizationId: ORG, criteria: { page: 2, pageSize: 5 } }]);
  });

  it('defaults to page 1 of 20 and accepts the only allowed sort', async () => {
    const store = new TestEvidenceStore(items);
    const response = await request(testApp('ADMIN', store)).get('/api/v1/delivery-evidence?sort=createdAt:desc');

    expect(response.status).toBe(200);
    expect(response.body.meta).toEqual({ page: 1, pageSize: 20, total: 12 });
    expect(response.body.data[0].order.publicCode).toBe('ORD-00000012');
  });

  it('passes the trimmed q and orderId to the store', async () => {
    const store = new TestEvidenceStore(items);
    const app = testApp('ADMIN', store);
    const byCode = await request(app).get('/api/v1/delivery-evidence').query({ q: '  ord-00000003 ' });
    const byRecipient = await request(app).get('/api/v1/delivery-evidence').query({ q: 'cliente 1' });
    const byOrder = await request(app).get('/api/v1/delivery-evidence').query({ orderId: vaultItem(4).orderId });
    const emptyQ = await request(app).get('/api/v1/delivery-evidence').query({ q: '   ' });

    expect(byCode.body.data.map((item: { orderId: string }) => item.orderId)).toEqual([vaultItem(3).orderId]);
    expect(byRecipient.body.meta.total).toBe(4);
    expect(byOrder.body.data.map((item: { orderId: string }) => item.orderId)).toEqual([vaultItem(4).orderId]);
    expect(emptyQ.body.meta.total).toBe(12);
    expect(store.vaultCalls.map((call) => call.criteria)).toEqual([
      { page: 1, pageSize: 20, q: 'ord-00000003' },
      { page: 1, pageSize: 20, q: 'cliente 1' },
      { page: 1, pageSize: 20, orderId: vaultItem(4).orderId },
      { page: 1, pageSize: 20 },
    ]);
  });

  it('scopes the vault to the caller organization', async () => {
    const store = new TestEvidenceStore(items);
    const own = await request(testApp('ADMIN', store)).get('/api/v1/delivery-evidence?q=ORD-OTRA-ORG');
    const other = await request(testApp('ADMIN', store, OTHER_ORG)).get('/api/v1/delivery-evidence');

    expect(own.body.meta.total).toBe(0);
    expect(other.body.meta.total).toBe(1);
    expect(other.body.data[0].order.publicCode).toBe('ORD-OTRA-ORG');
  });

  it.each([
    ['an unknown parameter', 'status=delivered'],
    ['organizationId', `organizationId=${OTHER_ORG}`],
    ['an ascending sort', 'sort=createdAt:asc'],
    ['a sort on another field', 'sort=publicCode:desc'],
    ['pageSize over 100', 'pageSize=101'],
    ['page 0', 'page=0'],
    ['a malformed orderId', 'orderId=not-a-uuid'],
    ['a search over 100 characters', `q=${'x'.repeat(101)}`],
  ])('rejects %s with 400', async (_label, query) => {
    const store = new TestEvidenceStore(items);
    const response = await request(testApp('ADMIN', store)).get(`/api/v1/delivery-evidence?${query}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DELIVERY_EVIDENCE_INVALID_INPUT');
    expect(response.body.error.details.issues.length).toBeGreaterThan(0);
    expect(store.vaultCalls).toEqual([]);
  });

  it('is limited to ADMIN and DISPATCHER', async () => {
    const store = new TestEvidenceStore(items);
    const response = await request(testApp('DRIVER', store)).get('/api/v1/delivery-evidence');

    expect(response.status).toBe(403);
    expect(store.vaultCalls).toEqual([]);
  });
});
