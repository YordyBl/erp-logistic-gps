import type { PageResult } from '../../../../http/pagination.js';

export type EvidenceMimeType = 'image/jpeg' | 'image/png' | 'image/webp';
export type EvidenceUploadStatus = 'pending_upload' | 'available';

export interface DeliveryEvidence {
  readonly id: string;
  readonly organizationId: string;
  readonly orderId: string;
  readonly attemptId: string;
  readonly incidentId: string | null;
  readonly mimeType: EvidenceMimeType;
  readonly byteSize: number;
  readonly checksum: string;
  readonly uploadedBy: string;
  readonly status: EvidenceUploadStatus;
  readonly createdAt: string;
  readonly availableAt: string | null;
}

export interface EvidenceUploadReservation extends DeliveryEvidence {
  readonly objectKey: string;
}

export interface ReserveDeliveryEvidenceInput {
  readonly id: string;
  readonly organizationId: string;
  readonly orderId: string;
  readonly actorUserId: string;
  readonly idempotencyKey: string;
  readonly mimeType: EvidenceMimeType;
  readonly byteSize: number;
  readonly checksum: string;
  readonly createdAt: string;
}

/** Order statuses whose evidence the back-office vault lists (closed outcomes). */
export const EVIDENCE_VAULT_ORDER_STATUSES = ['delivered', 'returned'] as const;
export type EvidenceVaultOrderStatus = (typeof EVIDENCE_VAULT_ORDER_STATUSES)[number];

/** Compact order shown next to each vault photo. */
export interface EvidenceVaultOrder {
  readonly id: string;
  readonly publicCode: string;
  readonly status: EvidenceVaultOrderStatus;
  readonly recipientName: string;
  readonly district: string;
}

export interface EvidenceVaultItem extends DeliveryEvidence {
  readonly order: EvidenceVaultOrder;
}

/**
 * One vault page. The order is fixed, newest first (`created_at DESC, id DESC`);
 * `q` matches the order public code or recipient name; `orderId` narrows to one order.
 */
export interface EvidenceVaultCriteria {
  readonly page: number;
  readonly pageSize: number;
  readonly q?: string;
  readonly orderId?: string;
}

export interface DeliveryEvidenceStore {
  reserveUpload(input: ReserveDeliveryEvidenceInput): Promise<EvidenceUploadReservation>;
  markAvailable(organizationId: string, evidenceId: string, availableAt: string): Promise<DeliveryEvidence>;
  listForOrder(organizationId: string, orderId: string, actorUserId: string): Promise<readonly DeliveryEvidence[]>;
  findForDownload(organizationId: string, evidenceId: string, actorUserId: string): Promise<EvidenceUploadReservation>;
  /**
   * Back-office vault: available evidence of the organization's delivered or
   * returned orders, newest first. The HTTP layer restricts it to ADMIN/DISPATCHER.
   */
  listVaultPage(organizationId: string, criteria: EvidenceVaultCriteria): Promise<PageResult<EvidenceVaultItem>>;
}
