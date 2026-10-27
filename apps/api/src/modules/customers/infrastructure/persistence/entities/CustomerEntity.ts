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
 * Persistence mapping for the customer catalog (Data Mapper; the domain entity
 * never imports this class).
 *
 * `uq_customers_organization_public_code` is the correctness boundary for
 * per-tenant code uniqueness; the adapter translates a `23505` violation into
 * `CustomerInvariantError`. Emails are stored lowercased by the domain.
 */
@Entity({ name: 'customers' })
@Unique('uq_customers_organization_public_code', ['organizationId', 'publicCode'])
@Index('idx_customers_organization_id', ['organizationId'])
@Check('chk_customers_status', `"status" IN ('active', 'inactive')`)
@Check('chk_customers_public_code', `"public_code" = upper("public_code")`)
@Check('chk_customers_contact_email', `"contact_email" = lower("contact_email")`)
export class CustomerEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne('OrganizationEntity', { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id' })
  organization!: CustomerOrganization;

  @Column({ name: 'public_code', type: 'varchar', length: 32 })
  publicCode!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'contact_name', type: 'varchar', length: 120 })
  contactName!: string;

  @Column({ name: 'contact_email', type: 'varchar', length: 254 })
  contactEmail!: string;

  @Column({ name: 'contact_phone', type: 'varchar', length: 32 })
  contactPhone!: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * Structural view of the organization row referenced by `organization_id`.
 *
 * Declared structurally so this module does not depend on the
 * `identity-and-access` entity class; TypeORM resolves the relation from the
 * string target registered in the data source.
 */
export interface CustomerOrganization {
  readonly id: string;
}
