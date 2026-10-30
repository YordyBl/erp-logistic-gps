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

export interface DeliveryEvidenceStore {
  reserveUpload(input: ReserveDeliveryEvidenceInput): Promise<EvidenceUploadReservation>;
  markAvailable(organizationId: string, evidenceId: string, availableAt: string): Promise<DeliveryEvidence>;
  listForOrder(organizationId: string, orderId: string, actorUserId: string): Promise<readonly DeliveryEvidence[]>;
  findForDownload(organizationId: string, evidenceId: string, actorUserId: string): Promise<EvidenceUploadReservation>;
}
