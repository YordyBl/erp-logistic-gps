import type { StoredRefreshToken } from '../../../application/ports/RefreshTokenStore.js';
import { RefreshTokenEntity } from '../entities/RefreshTokenEntity.js';

/** Explicit application ⇄ TypeORM mapping for refresh tokens. */
export function toRefreshTokenEntity(token: StoredRefreshToken): RefreshTokenEntity {
  const entity = new RefreshTokenEntity();

  entity.id = token.id;
  entity.userId = token.userId;
  entity.organizationId = token.organizationId;
  entity.tokenHash = token.tokenHash;
  entity.familyId = token.familyId;
  entity.issuedAt = new Date(token.issuedAt);
  entity.expiresAt = new Date(token.expiresAt);
  entity.revokedAt = token.revokedAt === null ? null : new Date(token.revokedAt);

  return entity;
}

export function toRefreshTokenDomain(entity: RefreshTokenEntity): StoredRefreshToken {
  return {
    id: entity.id,
    userId: entity.userId,
    organizationId: entity.organizationId,
    familyId: entity.familyId,
    tokenHash: entity.tokenHash,
    issuedAt: entity.issuedAt.toISOString(),
    expiresAt: entity.expiresAt.toISOString(),
    revokedAt: entity.revokedAt === null ? null : entity.revokedAt.toISOString(),
  };
}
