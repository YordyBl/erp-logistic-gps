import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import { SystemClock, type Clock } from '../../../../shared/clock.js';
import {
  DeliveryEvidenceUnavailableError,
  DeliveryEvidenceValidationError,
} from '../../domain/errors/DeliveryExecutionError.js';
import { prepareEvidenceImage } from '../../domain/EvidenceImage.js';
import type {
  DeliveryEvidence,
  DeliveryEvidenceStore,
  EvidenceMimeType,
} from '../ports/DeliveryEvidenceStore.js';
import type { EvidenceObjectStorage } from '../ports/EvidenceObjectStorage.js';

const uuidSchema = z.uuid();
const idempotencyKeySchema = z.string().trim().min(8).max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export interface DeliveryEvidenceDto {
  readonly id: string;
  readonly orderId: string;
  readonly attemptId: string;
  readonly incidentId: string | null;
  readonly mimeType: EvidenceMimeType;
  readonly byteSize: number;
  readonly checksum: string;
  readonly uploadedBy: string;
  readonly status: 'pending_upload' | 'available';
  readonly createdAt: string;
  readonly availableAt: string | null;
}

function toDto(value: {
  readonly id: string;
  readonly orderId: string;
  readonly attemptId: string;
  readonly incidentId: string | null;
  readonly mimeType: EvidenceMimeType;
  readonly byteSize: number;
  readonly checksum: string;
  readonly uploadedBy: string;
  readonly status: 'pending_upload' | 'available';
  readonly createdAt: string;
  readonly availableAt: string | null;
}): DeliveryEvidenceDto {
  return {
    id: value.id,
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

export class UploadDeliveryEvidenceUseCase {
  constructor(
    private readonly store: DeliveryEvidenceStore,
    private readonly objectStorage: EvidenceObjectStorage,
    private readonly clock: Clock = new SystemClock(),
  ) {}

  async execute(input: {
    readonly organizationId: string;
    readonly orderId: string;
    readonly actorUserId: string;
    readonly idempotencyKey: string;
    readonly declaredMimeType: string;
    readonly bytes: Buffer;
  }): Promise<{ readonly evidence: DeliveryEvidenceDto }> {
    const ids = [input.organizationId, input.orderId, input.actorUserId];
    if (ids.some((id) => !uuidSchema.safeParse(id).success) ||
        !idempotencyKeySchema.safeParse(input.idempotencyKey).success ||
        !Buffer.isBuffer(input.bytes)) {
      throw new DeliveryEvidenceValidationError('Upload delivery evidence command is invalid');
    }

    const prepared = prepareEvidenceImage(input.bytes, input.declaredMimeType);
    const checksum = createHash('sha256').update(prepared.bytes).digest('hex');
    const reservation = await this.store.reserveUpload({
      id: randomUUID(),
      organizationId: input.organizationId,
      orderId: input.orderId,
      actorUserId: input.actorUserId,
      idempotencyKey: input.idempotencyKey,
      mimeType: prepared.mimeType,
      byteSize: prepared.bytes.length,
      checksum,
      createdAt: this.clock.now(),
    });

    if (reservation.status === 'pending_upload') {
      try {
        await this.objectStorage.put(reservation.objectKey, prepared.bytes, prepared.mimeType);
      } catch {
        // Keep the reservation as pending. Storage outcomes can be uncertain; never
        // delete a possibly-written evidence object or make it available by guess.
        throw new DeliveryEvidenceUnavailableError();
      }

      let available: DeliveryEvidence;
      try {
        available = await this.store.markAvailable(
          input.organizationId,
          reservation.id,
          this.clock.now(),
        );
      } catch {
        // The object may already exist; keep metadata pending and retry with the same key.
        throw new DeliveryEvidenceUnavailableError();
      }
      return { evidence: toDto(available) };
    }

    return { evidence: toDto(reservation) };
  }
}

export class ListDeliveryEvidenceUseCase {
  constructor(private readonly store: DeliveryEvidenceStore) {}

  async execute(input: {
    readonly organizationId: string;
    readonly orderId: string;
    readonly actorUserId: string;
  }): Promise<{ readonly evidence: readonly DeliveryEvidenceDto[] }> {
    if ([input.organizationId, input.orderId, input.actorUserId]
      .some((id) => !uuidSchema.safeParse(id).success)) {
      throw new DeliveryEvidenceValidationError('List delivery evidence query is invalid');
    }
    const records = await this.store.listForOrder(
      input.organizationId,
      input.orderId,
      input.actorUserId,
    );
    return { evidence: records.map(toDto) };
  }
}

export class DownloadDeliveryEvidenceUseCase {
  constructor(
    private readonly store: DeliveryEvidenceStore,
    private readonly objectStorage: EvidenceObjectStorage,
  ) {}

  async execute(input: {
    readonly organizationId: string;
    readonly evidenceId: string;
    readonly actorUserId: string;
  }): Promise<{ readonly evidence: DeliveryEvidenceDto; readonly bytes: Buffer }> {
    if ([input.organizationId, input.evidenceId, input.actorUserId]
      .some((id) => !uuidSchema.safeParse(id).success)) {
      throw new DeliveryEvidenceValidationError('Download delivery evidence query is invalid');
    }
    const record = await this.store.findForDownload(
      input.organizationId,
      input.evidenceId,
      input.actorUserId,
    );
    if (record.status !== 'available') throw new DeliveryEvidenceUnavailableError();
    try {
      const bytes = await this.objectStorage.get(record.objectKey);
      if (bytes.length !== record.byteSize ||
          createHash('sha256').update(bytes).digest('hex') !== record.checksum) {
        throw new Error('Evidence object integrity check failed');
      }
      return { evidence: toDto(record), bytes };
    } catch {
      throw new DeliveryEvidenceUnavailableError();
    }
  }
}
