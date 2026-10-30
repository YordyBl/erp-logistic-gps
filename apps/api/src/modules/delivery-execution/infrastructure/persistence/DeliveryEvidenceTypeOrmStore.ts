import { IsNull, type DataSource, type EntityManager } from 'typeorm';

import {
  DeliveryEvidenceConflictError,
  DeliveryEvidenceNotFoundError,
} from '../../domain/errors/DeliveryExecutionError.js';
import type {
  DeliveryEvidence,
  DeliveryEvidenceStore,
  EvidenceMimeType,
  EvidenceUploadReservation,
  ReserveDeliveryEvidenceInput,
} from '../../application/ports/DeliveryEvidenceStore.js';
import { DeliveryEvidenceEntity } from './entities/DeliveryEvidenceEntity.js';

interface AuthorizedAttemptRow {
  readonly attemptId: string;
  readonly driverId: string;
}

/** Transactional persistence and tenant/driver authorization for evidence metadata. */
export class DeliveryEvidenceTypeOrmStore implements DeliveryEvidenceStore {
  constructor(private readonly dataSource: DataSource) {}

  async reserveUpload(input: ReserveDeliveryEvidenceInput): Promise<EvidenceUploadReservation> {
    return this.dataSource.transaction(async (manager) => {
      const attempts = await manager.query<AuthorizedAttemptRow[]>(`
        SELECT a.id AS "attemptId", a.driver_id AS "driverId"
        FROM delivery_orders o
        JOIN delivery_routes r ON r.organization_id=o.organization_id AND r.id=o.active_route_id
        JOIN delivery_attempts a ON a.organization_id=o.organization_id AND a.order_id=o.id
          AND a.route_id=r.id AND a.status='in_progress'
        JOIN drivers d ON d.organization_id=r.organization_id AND d.id=r.driver_id AND d.status='active'
        JOIN driver_accounts da ON da.organization_id=d.organization_id AND da.driver_id=d.id
        JOIN users u ON u.organization_id=da.organization_id AND u.id=da.user_id
          AND u.status='active' AND u.role='DRIVER'
        WHERE o.organization_id=$1 AND o.id=$2 AND o.status='in_transit'
          AND r.status='in_progress' AND u.id=$3
        FOR UPDATE OF o, r, a`,
      [input.organizationId, input.orderId, input.actorUserId]);
      const attempt = attempts[0];
      if (attempt === undefined) throw new DeliveryEvidenceNotFoundError();

      const prior = await manager.findOne(DeliveryEvidenceEntity, {
        where: {
          organizationId: input.organizationId,
          uploadedBy: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (prior !== null) {
        if (prior.orderId !== input.orderId || prior.attemptId !== attempt.attemptId ||
            prior.mimeType !== input.mimeType || prior.byteSize !== input.byteSize ||
            prior.checksum !== input.checksum) {
          throw new DeliveryEvidenceConflictError('Idempotency key was already used for different evidence');
        }
        return toReservation(prior);
      }

      const count = await manager.count(DeliveryEvidenceEntity, {
        where: {
          organizationId: input.organizationId,
          attemptId: attempt.attemptId,
          incidentId: IsNull(),
        },
      });
      if (count >= 2) {
        throw new DeliveryEvidenceConflictError('An attempt accepts at most two delivery photos');
      }

      const row = new DeliveryEvidenceEntity();
      row.id = input.id;
      row.organizationId = input.organizationId;
      row.orderId = input.orderId;
      row.attemptId = attempt.attemptId;
      row.incidentId = null;
      row.objectKey = `organizations/${input.organizationId}/orders/${input.orderId}/attempts/${attempt.attemptId}/${input.id}`;
      row.mimeType = input.mimeType;
      row.byteSize = input.byteSize;
      row.checksum = input.checksum;
      row.uploadedBy = input.actorUserId;
      row.idempotencyKey = input.idempotencyKey;
      row.status = 'pending_upload';
      row.createdAt = new Date(input.createdAt);
      row.availableAt = null;
      await manager.insert(DeliveryEvidenceEntity, row);
      return toReservation(row);
    });
  }

  async markAvailable(
    organizationId: string,
    evidenceId: string,
    availableAt: string,
  ): Promise<DeliveryEvidence> {
    return this.dataSource.transaction(async (manager) => {
      const evidence = await manager.findOne(DeliveryEvidenceEntity, {
        where: { organizationId, id: evidenceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (evidence === null) throw new DeliveryEvidenceNotFoundError();
      if (evidence.status === 'pending_upload') {
        evidence.status = 'available';
        evidence.availableAt = new Date(availableAt);
        await manager.save(DeliveryEvidenceEntity, evidence);
      }
      return toEvidence(evidence);
    });
  }

  async listForOrder(
    organizationId: string,
    orderId: string,
    actorUserId: string,
  ): Promise<readonly DeliveryEvidence[]> {
    return this.dataSource.transaction(async (manager) => {
      await requireReadAccess(manager, organizationId, orderId, actorUserId);
      const rows = await manager.find(DeliveryEvidenceEntity, {
        where: { organizationId, orderId },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      return rows.map(toEvidence);
    });
  }

  async findForDownload(
    organizationId: string,
    evidenceId: string,
    actorUserId: string,
  ): Promise<EvidenceUploadReservation> {
    return this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(DeliveryEvidenceEntity, {
        where: { organizationId, id: evidenceId, status: 'available' },
      });
      if (row === null) throw new DeliveryEvidenceNotFoundError();
      await requireReadAccess(manager, organizationId, row.orderId, actorUserId, row.attemptId);
      return toReservation(row);
    });
  }
}

async function requireReadAccess(
  manager: EntityManager,
  organizationId: string,
  orderId: string,
  actorUserId: string,
  attemptId?: string,
): Promise<void> {
  const rows = await manager.query<{ id: string }[]>(`
    SELECT o.id
    FROM delivery_orders o
    JOIN users u ON u.organization_id=o.organization_id AND u.id=$3 AND u.status='active'
    LEFT JOIN delivery_attempts a ON a.organization_id=o.organization_id AND a.order_id=o.id
      AND ($4::uuid IS NULL OR a.id=$4)
    LEFT JOIN driver_accounts da ON da.organization_id=a.organization_id AND da.driver_id=a.driver_id
      AND da.user_id=u.id
    LEFT JOIN drivers d ON d.organization_id=da.organization_id AND d.id=da.driver_id
    WHERE o.organization_id=$1 AND o.id=$2
      AND (u.role IN ('ADMIN','DISPATCHER') OR
        (u.role='DRIVER' AND da.user_id IS NOT NULL AND d.status='active'))
    LIMIT 1`,
  [organizationId, orderId, actorUserId, attemptId ?? null]);
  if (rows.length !== 1) throw new DeliveryEvidenceNotFoundError();
}

function toEvidence(row: DeliveryEvidenceEntity): DeliveryEvidence {
  return {
    id: row.id,
    organizationId: row.organizationId,
    orderId: row.orderId,
    attemptId: row.attemptId,
    incidentId: row.incidentId,
    mimeType: row.mimeType as EvidenceMimeType,
    byteSize: row.byteSize,
    checksum: row.checksum,
    uploadedBy: row.uploadedBy,
    status: row.status as DeliveryEvidence['status'],
    createdAt: row.createdAt.toISOString(),
    availableAt: row.availableAt?.toISOString() ?? null,
  };
}

function toReservation(row: DeliveryEvidenceEntity): EvidenceUploadReservation {
  return { ...toEvidence(row), objectKey: row.objectKey };
}
