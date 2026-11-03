import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type {
  DeliveryEvidence,
  DeliveryEvidenceStore,
  EvidenceUploadReservation,
  ReserveDeliveryEvidenceInput,
} from '../../modules/delivery-execution/application/ports/DeliveryEvidenceStore.js';
import { createDeliveryExecutionModule } from '../../modules/delivery-execution/composition/composition-root.js';
import { prepareEvidenceImage } from '../../modules/delivery-execution/domain/EvidenceImage.js';
import { S3EvidenceObjectStorage } from '../../modules/delivery-execution/infrastructure/S3EvidenceObjectStorage.js';
import { VALID_JPEG } from '../../modules/delivery-execution/tests/evidence-fixtures.js';
import { DRIVER_ID, ORGANIZATION_ID, buildTestApp, bearer } from './support/test-app.js';

type TestExpressApp = Express;

const endpoint = process.env.MINIO_TEST_ENDPOINT;
const accessKey = process.env.MINIO_TEST_ACCESS_KEY;
const secretKey = process.env.MINIO_TEST_SECRET_KEY;
const bucket = process.env.MINIO_TEST_BUCKET;

class InMemoryEvidenceStore implements DeliveryEvidenceStore {
  private readonly records = new Map<string, EvidenceUploadReservation>();
  private readonly idempotency = new Map<string, string>();

  async reserveUpload(input: ReserveDeliveryEvidenceInput): Promise<EvidenceUploadReservation> {
    const idempotencyKey = `${input.organizationId}:${input.actorUserId}:${input.idempotencyKey}`;
    const previousId = this.idempotency.get(idempotencyKey);
    const previous = previousId === undefined ? undefined : this.records.get(previousId);
    if (previous !== undefined) return previous;

    const id = randomUUID();
    const record: EvidenceUploadReservation = {
      id,
      organizationId: input.organizationId,
      orderId: input.orderId,
      attemptId: '44444444-4444-4444-8444-444444444444',
      incidentId: null,
      objectKey: `${input.organizationId}/${input.orderId}/${id}`,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      checksum: input.checksum,
      uploadedBy: input.actorUserId,
      status: 'pending_upload',
      createdAt: input.createdAt,
      availableAt: null,
    };
    this.records.set(id, record);
    this.idempotency.set(idempotencyKey, id);
    return record;
  }

  async markAvailable(
    organizationId: string,
    evidenceId: string,
    availableAt: string,
  ): Promise<DeliveryEvidence> {
    const record = this.requireRecord(organizationId, evidenceId, undefined);
    const available = { ...record, status: 'available' as const, availableAt };
    this.records.set(evidenceId, available);
    return available;
  }

  async listForOrder(
    organizationId: string,
    orderId: string,
    actorUserId: string,
  ): Promise<readonly DeliveryEvidence[]> {
    return [...this.records.values()]
      .filter((record) => record.organizationId === organizationId &&
        record.orderId === orderId && record.uploadedBy === actorUserId && record.status === 'available');
  }

  async findForDownload(
    organizationId: string,
    evidenceId: string,
    actorUserId: string,
  ): Promise<EvidenceUploadReservation> {
    return this.requireRecord(organizationId, evidenceId, actorUserId);
  }

  private requireRecord(
    organizationId: string,
    evidenceId: string,
    actorUserId: string | undefined,
  ): EvidenceUploadReservation {
    const record = this.records.get(evidenceId);
    if (record === undefined || record.organizationId !== organizationId ||
        (actorUserId !== undefined && record.uploadedBy !== actorUserId)) {
      throw new Error('Evidence record not found');
    }
    return record;
  }
}

describe.skipIf(endpoint === undefined || accessKey === undefined ||
  secretKey === undefined || bucket === undefined)('delivery evidence with real MinIO', () => {
  it('uploads through the authenticated HTTP route and downloads the same private object', async () => {
    const objectStorage = new S3EvidenceObjectStorage({
      endpoint: endpoint!,
      accessKey: accessKey!,
      secretKey: secretKey!,
      bucket: bucket!,
      region: process.env.MINIO_TEST_REGION ?? 'us-east-1',
    });
    const module = createDeliveryExecutionModule({
      store: new InMemoryEvidenceStore(),
      objectStorage,
    });
    const testApp = buildTestApp({ deliveryExecution: module });
    await testApp.seedOrganization({ id: ORGANIZATION_ID });
    const driver = await testApp.seedUser({ id: DRIVER_ID, role: 'DRIVER' });
    const token = await testApp.signIn(driver);
    const orderId = '22222222-2222-4222-8222-222222222222';
    const idempotencyKey = `minio-${randomUUID()}`;
    const storedBytes = prepareEvidenceImage(VALID_JPEG, 'image/jpeg').bytes;

    const uploaded = await requestEvidenceUpload(testApp.app, token, orderId, idempotencyKey);
    const listed = await requestEvidenceList(testApp.app, token, orderId);
    const evidenceId = uploaded.body.data.id as string;
    const downloaded = await requestEvidenceDownload(testApp.app, token, evidenceId);

    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.status).toBe('available');
    expect(uploaded.body.data).not.toHaveProperty('objectKey');
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers['cache-control']).toBe('private, no-store');
    expect(downloaded.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(downloaded.body)).toEqual(storedBytes);
    expect(listed.body.data[0]).toMatchObject({
      id: evidenceId,
      byteSize: storedBytes.length,
      checksum: uploaded.body.data.checksum,
    });

    const retry = await requestEvidenceUpload(testApp.app, token, orderId, idempotencyKey);
    expect(retry.status).toBe(201);
    expect(retry.body.data.id).toBe(evidenceId);
  });
});

async function requestEvidenceUpload(
  app: TestExpressApp,
  token: string,
  orderId: string,
  idempotencyKey: string,
) {
  return request(app).post(`/api/v1/delivery-orders/${orderId}/evidence`)
    .set(bearer(token))
    .set('Content-Type', 'image/jpeg')
    .set('Idempotency-Key', idempotencyKey)
    .send(VALID_JPEG);
}

async function requestEvidenceList(
  app: TestExpressApp,
  token: string,
  orderId: string,
) {
  return request(app).get(`/api/v1/delivery-orders/${orderId}/evidence`).set(bearer(token));
}

async function requestEvidenceDownload(
  app: TestExpressApp,
  token: string,
  evidenceId: string,
) {
  return request(app).get(`/api/v1/evidence/${evidenceId}/download`).set(bearer(token));
}
