import {
  InvalidTokenError,
  RefreshNotFoundError,
  RefreshReuseDetectedError,
} from '../../../domain/errors/IdentityError.js';
import { isExpired, type SessionPolicy } from '../../../domain/policies/session-policy.js';
import type { Clock } from '../../ports/Clock.js';
import type { IdGenerator } from '../../ports/IdGenerator.js';
import type { RefreshTokenStore } from '../../ports/RefreshTokenStore.js';
import type { TokenService } from '../../ports/TokenService.js';
import type { UserRepository } from '../../ports/UserRepository.js';
import { createSession } from '../shared/create-session.js';
import { parseRefreshSessionCommand } from './RefreshSessionCommand.js';
import type { RefreshSessionResult } from './RefreshSessionResult.js';

export interface RefreshSessionDependencies {
  readonly users: UserRepository;
  readonly tokenService: TokenService;
  readonly refreshTokens: RefreshTokenStore;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly sessionPolicy: SessionPolicy;
}

/**
 * Rotates a refresh token inside its family.
 *
 * Decision order matters:
 * 1. Unknown hash → not found (no state change).
 * 2. Already revoked → reuse: revoke the whole family, then report reuse. The
 *    current rotation winner is revoked too, so an attacker and the victim both
 *    lose the chain and must log in again (ADR-003 §3).
 * 3. Expired → typed invalid-token error with `reason: "expired"`; nothing is
 *    rotated.
 * 4. Live → consume it with an atomic `revokeOne`. Losing the race means
 *    another request rotated it first, which is also treated as reuse.
 *
 * The user is reloaded from storage, so a role change or a disabled account
 * takes effect at the next refresh instead of surviving in the old session.
 */
export class RefreshSessionUseCase {
  constructor(private readonly dependencies: RefreshSessionDependencies) {}

  async execute(input: unknown): Promise<RefreshSessionResult> {
    const command = parseRefreshSessionCommand(input);
    const now = this.dependencies.clock.now();
    const tokenHash = this.dependencies.tokenService.hashRefresh(command.refreshToken);

    const stored = await this.dependencies.refreshTokens.findByHash(tokenHash);

    if (stored === null) {
      throw new RefreshNotFoundError();
    }

    if (stored.revokedAt !== null) {
      await this.dependencies.refreshTokens.revokeFamily(stored.familyId, now);
      throw new RefreshReuseDetectedError(stored.familyId);
    }

    if (isExpired(stored.expiresAt, now)) {
      throw new InvalidTokenError('Refresh token has expired', { reason: 'expired' });
    }

    const consumed = await this.dependencies.refreshTokens.revokeOne(stored.id, now);

    if (!consumed) {
      await this.dependencies.refreshTokens.revokeFamily(stored.familyId, now);
      throw new RefreshReuseDetectedError(stored.familyId);
    }

    const user = await this.dependencies.users.findById(stored.userId);

    if (user === null || user.status !== 'active') {
      throw new InvalidTokenError('Refresh session is no longer valid', {
        reason: 'user_unavailable',
      });
    }

    if (user.organizationId !== stored.organizationId) {
      await this.dependencies.refreshTokens.revokeFamily(stored.familyId, now);
      throw new InvalidTokenError('Refresh session is no longer valid', {
        reason: 'organization_mismatch',
      });
    }

    return createSession(user, stored.familyId, now, {
      tokenService: this.dependencies.tokenService,
      refreshTokens: this.dependencies.refreshTokens,
      idGenerator: this.dependencies.idGenerator,
      sessionPolicy: this.dependencies.sessionPolicy,
    });
  }
}
