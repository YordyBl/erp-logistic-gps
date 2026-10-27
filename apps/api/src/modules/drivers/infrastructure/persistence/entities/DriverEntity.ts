import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';

/**
 * Persistence mapping for the driver catalog (Data Mapper; the domain entity
 * never imports this class).
 *
 * `uq_drivers_organization_document_number` is the correctness boundary for
 * per-tenant document uniqueness; the adapter translates a `23505` violation
 * into `DriverInvariantError`.
 */
@Entity({ name: 'drivers' })
@Unique('uq_drivers_organization_id', ['organizationId', 'id'])
@Unique('uq_drivers_organization_document_number', [
  'organizationId',
  'documentNumber',
])
@Index('idx_drivers_organization_id', ['organizationId'])
@Check('chk_drivers_status', `"status" IN ('active', 'inactive')`)
@Check(
  'chk_drivers_document_number',
  `"document_number" = upper("document_number")`,
)
@Check('chk_drivers_license_number', `"license_number" = upper("license_number")`)
@Check('chk_drivers_updated_at', `"updated_at" >= "created_at"`)
export class DriverEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne('OrganizationEntity', { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id' })
  organization!: DriverOrganization;

  @Column({ name: 'full_name', type: 'varchar', length: 120 })
  fullName!: string;

  @Column({ name: 'document_number', type: 'varchar', length: 20 })
  documentNumber!: string;

  @Column({ type: 'varchar', length: 32 })
  phone!: string;

  @Column({ name: 'license_number', type: 'varchar', length: 40 })
  licenseNumber!: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * Structural view of the organization row referenced by `organization_id`.
 *
 * Declared structurally so this module does not depend on the
 * `identity-and-access` entity class; TypeORM resolves the relation from the
 * string target registered in the data source.
 */
export interface DriverOrganization {
  readonly id: string;
}
