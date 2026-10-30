import { Check, Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

@Entity({ name: 'delivery_evidence' })
@Unique('uq_delivery_evidence_org_id', ['organizationId', 'id'])
@Unique('uq_delivery_evidence_idempotency', ['organizationId', 'uploadedBy', 'idempotencyKey'])
@Index('idx_delivery_evidence_attempt', ['organizationId', 'attemptId', 'status'])
@Check('chk_delivery_evidence_status', `"status" IN ('pending_upload', 'available')`)
@Check('chk_delivery_evidence_mime_type', `"mime_type" IN ('image/jpeg', 'image/png', 'image/webp')`)
@Check('chk_delivery_evidence_byte_size', '"byte_size" BETWEEN 1 AND 5000000')
export class DeliveryEvidenceEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'attempt_id', type: 'uuid' })
  attemptId!: string;

  @Column({ name: 'incident_id', type: 'uuid', nullable: true })
  incidentId!: string | null;

  @Column({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 32 })
  mimeType!: string;

  @Column({ name: 'byte_size', type: 'integer' })
  byteSize!: number;

  @Column({ type: 'char', length: 64 })
  checksum!: string;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedBy!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'available_at', type: 'timestamptz', nullable: true })
  availableAt!: Date | null;
}
