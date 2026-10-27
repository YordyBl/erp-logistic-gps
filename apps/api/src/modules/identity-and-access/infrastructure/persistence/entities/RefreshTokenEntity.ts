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
import { UserEntity } from './UserEntity.js';

/**
 * Persistence mapping for opaque rotating refresh tokens.
 *
 * Only the SHA-256 hash is stored. The family index is what makes reuse
 * detection cheap: revoking a compromised device session is one UPDATE over
 * `family_id`. `chk_refresh_tokens_expiry` rejects nonsensical rows before they
 * can be trusted by the rotation logic.
 */
@Entity({ name: 'refresh_tokens' })
@Unique('uq_refresh_tokens_token_hash', ['tokenHash'])
@Index('idx_refresh_tokens_family_id', ['familyId'])
@Index('idx_refresh_tokens_user_id', ['userId'])
@Check('chk_refresh_tokens_expiry', `"expires_at" > "issued_at"`)
export class RefreshTokenEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserEntity;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @ManyToOne(() => OrganizationEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization!: OrganizationEntity;

  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ name: 'family_id', type: 'uuid' })
  familyId!: string;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
