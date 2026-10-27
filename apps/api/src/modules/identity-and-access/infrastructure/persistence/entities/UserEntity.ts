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

import { OrganizationEntity } from './OrganizationEntity.js';

/**
 * Persistence mapping for platform users (Data Mapper; the domain entity never
 * imports this class).
 *
 * `uq_users_organization_email` is the correctness boundary for per-tenant
 * email uniqueness; the use case pre-check is a fast path and the adapter
 * translates a `23505` violation into the typed `EmailAlreadyInUseError`.
 * Emails are stored lowercased by the domain; `chk_users_email` keeps that
 * invariant even for rows written outside the application.
 */
@Entity({ name: 'users' })
@Unique('uq_users_organization_email', ['organizationId', 'email'])
@Index('idx_users_organization_id', ['organizationId'])
@Check('chk_users_role', `"role" IN ('ADMIN', 'DISPATCHER', 'DRIVER')`)
@Check('chk_users_status', `"status" IN ('active', 'disabled')`)
@Check('chk_users_email', `"email" = lower("email")`)
export class UserEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ type: 'varchar', length: 254 })
  email!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 20 })
  role!: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
