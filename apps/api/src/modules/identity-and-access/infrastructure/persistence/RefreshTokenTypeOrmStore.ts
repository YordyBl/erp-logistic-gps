import type { DataSource } from 'typeorm';

import type {
  RefreshTokenStore,
  StoredRefreshToken,
} from '../../application/ports/RefreshTokenStore.js';
import { InvalidTokenError } from '../../domain/errors/IdentityError.js';
import { RefreshTokenEntity } from './entities/RefreshTokenEntity.js';
import {
  toRefreshTokenDomain,
  toRefreshTokenEntity,
} from './mappers/RefreshTokenMapper.js';
import { readPostgresDriverError, toError } from './postgres-error.js';

/**
 * PostgreSQL adapter for the {@link RefreshTokenStore} port.
 *
 * Revocation is a conditional UPDATE (`revoked_at IS NULL`), which gives the
 * single-winner semantics rotation depends on: two concurrent refreshes of the
 * same token produce exactly one `true`, and the loser is treated as reuse.
 * This is a single-statement operation, so it is atomic without an explicit
 * transaction.
 */
export class RefreshTokenTypeOrmStore implements RefreshTokenStore {
  constructor(private readonly dataSource: DataSource) {}

  async save(token: StoredRefreshToken): Promise<void> {
    try {
      await this.dataSource
        .getRepository(RefreshTokenEntity)
        .save(toRefreshTokenEntity(token));
    } catch (error) {
      const driverError = readPostgresDriverError(error);

      if (
        driverError?.code === '23505' &&
        driverError.constraint === 'uq_refresh_tokens_token_hash'
      ) {
        // A SHA-256 collision on a 256-bit random token is not a realistic
        // event; treat it as an unusable token rather than a server fault.
        throw new InvalidTokenError('Refresh token could not be persisted', {
          reason: 'duplicate_token',
        });
      }

      throw toError(error);
    }
  }

  async findByHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    const entity = await this.dataSource
      .getRepository(RefreshTokenEntity)
      .findOne({ where: { tokenHash } });

    return entity === null ? null : toRefreshTokenDomain(entity);
  }

  async revokeOne(tokenId: string, revokedAt: string): Promise<boolean> {
    const result = await this.dataSource
      .getRepository(RefreshTokenEntity)
      .createQueryBuilder()
      .update()
      .set({ revokedAt: new Date(revokedAt) })
      .where('"id" = :tokenId', { tokenId })
      .andWhere('"revoked_at" IS NULL')
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async revokeFamily(familyId: string, revokedAt: string): Promise<void> {
    await this.dataSource
      .getRepository(RefreshTokenEntity)
      .createQueryBuilder()
      .update()
      .set({ revokedAt: new Date(revokedAt) })
      .where('"family_id" = :familyId', { familyId })
      .andWhere('"revoked_at" IS NULL')
      .execute();
  }
}
