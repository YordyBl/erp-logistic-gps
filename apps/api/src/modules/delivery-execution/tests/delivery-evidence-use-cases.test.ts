import { describe, expect, it, vi } from 'vitest';

import {
  DownloadDeliveryEvidenceUseCase,
  UploadDeliveryEvidenceUseCase,
} from '../application/use-cases/DeliveryEvidenceUseCases.js';
import type {
  DeliveryEvidence,
  DeliveryEvidenceStore,
  EvidenceUploadReservation,
} from '../application/ports/DeliveryEvidenceStore.js';
import type { EvidenceObjectStorage } from '../application/ports/EvidenceObjectStorage.js';
import { DeliveryEvidenceUnavailableError } from '../domain/errors/DeliveryExecutionError.js';
import { VALID_JPEG } from './evidence-fixtures.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';
const DRIVER = '33333333-3333-4333-8333-333333333333';
const ATTEMPT = '44444444-4444-4444-8444-444444444444';
const EVIDENCE = '55555555-5555-4555-8555-555555555555';
const AT = '2026-10-29T12:00:00.000Z';
const JPEG = VALID_JPEG;

function reservation(status: EvidenceUploadReservation['status'] = 'pending_upload'):
EvidenceUploadReservation {
  return {
    id: EVIDENCE, organizationId: ORG, orderId: ORDER, attemptId: ATTEMPT,
    incidentId: null, objectKey: 'organizations/org/orders/order/attempts/attempt/evidence',
    mimeType: 'image/jpeg', byteSize: JPEG.length,
    checksum: 'a'.repeat(64), uploadedBy: DRIVER, status,
    createdAt: AT, availableAt: status === 'available' ? AT : null,
  };
}

function evidence(): DeliveryEvidence {
  const value = reservation('available');
  return {
    id: value.id,
    organizationId: value.organizationId,
    orderId: value.orderId,
    attemptId: value.attemptId,
    incidentId: value.incidentId,
    mimeType: value.mimeType,
    byteSize: value.byteSize,
    checksum: value.checksum,
    uploadedBy: value.uploadedBy,
    status: value.status,
    createdAt: value.createdAt,
    availableAt: value.availableAt,
  };
}

function storeDouble(): DeliveryEvidenceStore & {
  readonly reserve: ReturnType<typeof vi.fn>;
  readonly complete: ReturnType<typeof vi.fn>;
} {
  const value = reservation();
  const reserve = vi.fn(async () => value);
  const complete = vi.fn(async () => evidence());
  return {
    reserve,
    complete,
    reserveUpload: reserve,
    markAvailable: complete,
    listForOrder: vi.fn(async () => []),
    findForDownload: vi.fn(async () => reservation('available')),
  };
}

describe('delivery evidence use cases', () => {
  it('reserves metadata, writes private bytes, then marks the evidence available', async () => {
    const store = storeDouble();
    const objectStorage: EvidenceObjectStorage = { put: vi.fn(), get: vi.fn() };
    const useCase = new UploadDeliveryEvidenceUseCase(store, objectStorage, { now: () => AT });

    const result = await useCase.execute({
      organizationId: ORG, orderId: ORDER, actorUserId: DRIVER,
      idempotencyKey: 'photo-attempt-1', declaredMimeType: 'image/jpeg', bytes: JPEG,
    });

    expect(store.reserve).toHaveBeenCalledOnce();
    expect(objectStorage.put).toHaveBeenCalledWith(
      reservation().objectKey, expect.any(Buffer), 'image/jpeg',
    );
    expect(store.complete).toHaveBeenCalledWith(ORG, EVIDENCE, AT);
    expect(result.evidence).toMatchObject({ id: EVIDENCE, status: 'available' });
    expect(result.evidence).not.toHaveProperty('objectKey');
  });

  it('keeps failed writes pending and never deletes or exposes the object', async () => {
    const store = storeDouble();
    const objectStorage: EvidenceObjectStorage = {
      put: vi.fn(async () => { throw new Error('storage timeout'); }),
      get: vi.fn(),
    };
    const useCase = new UploadDeliveryEvidenceUseCase(store, objectStorage, { now: () => AT });

    await expect(useCase.execute({
      organizationId: ORG, orderId: ORDER, actorUserId: DRIVER,
      idempotencyKey: 'photo-attempt-2', declaredMimeType: 'image/jpeg', bytes: JPEG,
    })).rejects.toBeInstanceOf(DeliveryEvidenceUnavailableError);

    expect(store.complete).not.toHaveBeenCalled();
    expect(objectStorage).not.toHaveProperty('delete');
  });

  it('does not repeat a completed upload when the same idempotency key is retried', async () => {
    const store = storeDouble();
    store.reserve.mockResolvedValue(reservation('available'));
    const objectStorage: EvidenceObjectStorage = { put: vi.fn(), get: vi.fn() };
    const useCase = new UploadDeliveryEvidenceUseCase(store, objectStorage, { now: () => AT });

    const result = await useCase.execute({
      organizationId: ORG, orderId: ORDER, actorUserId: DRIVER,
      idempotencyKey: 'photo-attempt-3', declaredMimeType: 'image/jpeg', bytes: JPEG,
    });

    expect(objectStorage.put).not.toHaveBeenCalled();
    expect(store.complete).not.toHaveBeenCalled();
    expect(result.evidence.status).toBe('available');
  });

  it('checks object size and checksum before returning a download', async () => {
    const store = storeDouble();
    const wrongBytes = Buffer.from('different');
    const objectStorage: EvidenceObjectStorage = { put: vi.fn(), get: vi.fn(async () => wrongBytes) };
    const useCase = new DownloadDeliveryEvidenceUseCase(store, objectStorage);

    await expect(useCase.execute({
      organizationId: ORG, evidenceId: EVIDENCE, actorUserId: DRIVER,
    })).rejects.toBeInstanceOf(DeliveryEvidenceUnavailableError);
  });
});
