import type { User } from '../../../domain/entities/User.js';
import { addSeconds, type SessionPolicy } from '../../../domain/policies/session-policy.js';
import type { AuthSessionDto } from '../../dto/AuthSessionDto.js';
import { toAuthenticatedUserDto } from '../../dto/IdentityDto.js';
import type { IdGenerator } from '../../ports/IdGenerator.js';
import type { RefreshTokenStore } from '../../ports/RefreshTokenStore.js';
import type { TokenService } from '../../ports/TokenService.js';

export interface SessionIssuanceDependencies {
  readonly tokenService: TokenService;
  readonly refreshTokens: RefreshTokenStore;
  readonly idGenerator: IdGenerator;
  readonly sessionPolicy: SessionPolicy;
}

/**
 * Issues and persists one session step (initial login or rotation).
 *
 * Shared by `login` and `refresh-session` so both paths use exactly the same
 * claim set and persistence shape. `familyId` is stable across rotations; the
 * refresh row is written before the DTO is returned, so an unsaved token is
 * never handed to a client.
 */
export async function createSession(
  user: User,
  familyId: string,
  now: string,
  dependencies: SessionIssuanceDependencies,
): Promise<AuthSessionDto> {
  const jti = dependencies.idGenerator.nextId();
  const exp =
    Math.floor(Date.parse(now) / 1000) +
    dependencies.sessionPolicy.accessTokenTtlSeconds;

  const accessToken = await dependencies.tokenService.issueAccess({
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
    jti,
    exp,
  });

  const refresh = dependencies.tokenService.generateRefresh();
  const refreshTokenExpiresAt = addSeconds(
    now,
    dependencies.sessionPolicy.refreshTokenTtlSeconds,
  );

  await dependencies.refreshTokens.save({
    id: dependencies.idGenerator.nextId(),
    userId: user.id,
    organizationId: user.organizationId,
    familyId,
    tokenHash: refresh.hash,
    issuedAt: now,
    expiresAt: refreshTokenExpiresAt,
    revokedAt: null,
  });

  return {
    accessToken,
    accessTokenExpiresAt: new Date(exp * 1000).toISOString(),
    refreshToken: refresh.token,
    refreshTokenExpiresAt,
    user: toAuthenticatedUserDto(user),
  };
}
