import { createHash, randomBytes } from 'node:crypto';

import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

import type {
  IssueAccessTokenInput,
  TokenService,
  VerifiedAccessToken,
} from '../../application/ports/TokenService.js';
import { isUserRole } from '../../domain/entities/User.js';
import { InvalidTokenError } from '../../domain/errors/IdentityError.js';
import { isUuid } from '../../../../shared/ids.js';

/** The only accepted signing algorithm (ADR-003 §2). */
export const ACCESS_TOKEN_ALGORITHM = 'HS256' as const;

const ALLOWED_ALGORITHMS = [ACCESS_TOKEN_ALGORITHM] as const;

const REFRESH_TOKEN_BYTES = 32;

const DEFAULT_CLOCK_TOLERANCE_SECONDS = 30;

export interface JwtTokenServiceOptions {
  /** HS256 secret, at least 32 characters. Supplied by configuration. */
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  /** Accepted clock skew for `exp`/`nbf`, in seconds. Defaults to 30. */
  readonly clockToleranceSeconds?: number;
}

/**
 * jose-backed token adapter.
 *
 * Access tokens are HS256 JWTs with an explicit algorithm allowlist; `none` or
 * any header-swapped algorithm is rejected before claims are read. Issuer,
 * audience and `iss`, `aud`, `exp`, `nbf`, `sub`, `jti` and `iat` are required.
 *
 * Refresh tokens are opaque 256-bit URL-safe random strings, never JWTs. Only
 * their SHA-256 hash is persisted; the raw value exists solely in the client
 * cookie and in memory during the request.
 */
export class JwtTokenService implements TokenService {
  private readonly key: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly clockToleranceSeconds: number;

  constructor(options: JwtTokenServiceOptions) {
    if (options.secret.length < 32) {
      throw new Error('JWT secret must be at least 32 characters');
    }

    this.key = new TextEncoder().encode(options.secret);
    this.issuer = options.issuer;
    this.audience = options.audience;
    this.clockToleranceSeconds =
      options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  }

  async issueAccess(input: IssueAccessTokenInput): Promise<string> {
    const issuedAt = Math.floor(Date.now() / 1000);

    return new SignJWT({
      organizationId: input.organizationId,
      role: input.role,
    })
      .setProtectedHeader({ alg: ACCESS_TOKEN_ALGORITHM })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setSubject(input.userId)
      .setJti(input.jti)
      .setIssuedAt(issuedAt)
      .setNotBefore(issuedAt)
      .setExpirationTime(input.exp)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<VerifiedAccessToken> {
    let payload: JWTPayload;

    try {
      ({ payload } = await jwtVerify(token, this.key, {
        algorithms: [...ALLOWED_ALGORITHMS],
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: this.clockToleranceSeconds,
        requiredClaims: ['iss', 'aud', 'exp', 'nbf', 'sub', 'jti', 'iat'],
      }));
    } catch (error) {
      throw new InvalidTokenError('Access token is invalid', {
        reason: classifyVerificationFailure(error),
      });
    }

    const organizationId = payload['organizationId'];
    const role = payload['role'];

    if (
      typeof payload.sub !== 'string' ||
      !isUuid(payload.sub) ||
      typeof payload.jti !== 'string' ||
      !isUuid(payload.jti) ||
      typeof payload.exp !== 'number' ||
      typeof payload.iat !== 'number' ||
      typeof organizationId !== 'string' ||
      !isUuid(organizationId) ||
      !isUserRole(role)
    ) {
      throw new InvalidTokenError('Access token claims are invalid', {
        reason: 'invalid_claims',
      });
    }

    return {
      userId: payload.sub,
      organizationId,
      role,
      jti: payload.jti,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      issuedAt: new Date(payload.iat * 1000).toISOString(),
    };
  }

  generateRefresh(): { token: string; hash: string } {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    return { token, hash: this.hashRefresh(token) };
  }

  hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

function classifyVerificationFailure(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;

    if (code === 'ERR_JWT_EXPIRED') {
      return 'expired';
    }

    if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
      return 'invalid_claims';
    }

    if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
      return 'invalid_signature';
    }

    if (code === 'ERR_JOSE_ALG_NOT_ALLOWED') {
      return 'algorithm_not_allowed';
    }
  }

  return 'invalid_token';
}
