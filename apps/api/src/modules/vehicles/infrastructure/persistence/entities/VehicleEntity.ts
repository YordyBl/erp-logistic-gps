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
 * Persistence mapping for the vehicle catalog (Data Mapper; the domain entity
 * never imports this class).
 *
 * `uq_vehicles_organization_plate` is the correctness boundary for per-tenant
 * plate uniqueness; the adapter translates a `23505` violation into
 * `VehicleInvariantError`. `capacity_kg` is `numeric` so a weight keeps its exact
 * decimal value.
 */
@Entity({ name: 'vehicles' })
@Unique('uq_vehicles_organization_plate', ['organizationId', 'plate'])
@Index('idx_vehicles_organization_id', ['organizationId'])
@Check('chk_vehicles_status', `"status" IN ('active', 'inactive')`)
@Check('chk_vehicles_plate', `"plate" = upper("plate")`)
@Check(
  'chk_vehicles_capacity',
  `"capacity_kg" IS NULL OR ("capacity_kg" > 0 AND "capacity_kg" <= 100000)`,
)
@Check('chk_vehicles_updated_at', `"updated_at" >= "created_at"`)
export class VehicleEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne('OrganizationEntity', { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id' })
  organization!: VehicleOrganization;

  @Column({ type: 'varchar', length: 16 })
  plate!: string;

  @Column({ type: 'varchar', length: 40 })
  type!: string;

  @Column({
    name: 'capacity_kg',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  capacityKg!: string | null;

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
export interface VehicleOrganization {
  readonly id: string;
}
