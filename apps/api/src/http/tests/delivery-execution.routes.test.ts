import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import type {
  DeliveryEvidence,
  DeliveryEvidenceStore,
  EvidenceUploadReservation,
} from '../../modules/delivery-execution/application/ports/DeliveryEvidenceStore.js';
import type { EvidenceObjectStorage } from '../../modules/delivery-execution/application/ports/EvidenceObjectStorage.js';
import { createDeliveryExecutionModule } from '../../modules/delivery-execution/composition/composition-root.js';
import { createErrorHandler } from '../middleware/error-handler.js';
import { setAuthenticatedUser, type AuthenticatedUser } from '../request-context.js';
import { createDeliveryExecutionRouter } from '../routes/delivery-execution.routes.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';
const ATTEMPT = '44444444-4444-4444-8444-444444444444';
const EVIDENCE = '55555555-5555-4555-8555-555555555555';
const AT = '2026-10-29T12:00:00.000Z';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]);

class TestEvidenceStore implements DeliveryEvidenceStore {
  private record: EvidenceUploadReservation | undefined;

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

function testApp(role: AuthenticatedUser['role'] = 'DRIVER') {
  const actor: AuthenticatedUser = {
    id: '33333333-3333-4333-8333-333333333333',
    organizationId: ORG,
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
    store: new TestEvidenceStore(),
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
