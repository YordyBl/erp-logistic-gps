import type { UserRole } from '../../domain/entities/User.js';

/**
 * Claims the application supplies when minting an access token.
 *
 * `exp` is Unix seconds and is computed by the use case from the `Clock` and the
 * session policy, so token lifetime is testable and not hidden in the adapter.
 * `jti` is a UUID used for audit correlation.
 */
export interface IssueAccessTokenInput {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: UserRole;
  readonly jti: string;
  readonly exp: number;
}

/** Validated claims returned by `verifyAccess`. */
export interface VerifiedAccessToken {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: UserRole;
  readonly jti: string;
  readonly expiresAt: string;
  readonly issuedAt: string;
}

/**
 * Token boundary of the module.
 *
 * The production adapter signs JWTs with HS256 (explicit algorithm allowlist)
 * and generates opaque 256-bit refresh tokens. `generateRefresh` returns both
 * the raw value (sent to the client) and its SHA-256 hash (persisted);
 * `hashRefresh` recomputes the hash for a presented token. The refresh token is
 * never a JWT and never stored in plaintext.
 */
export interface TokenService {
  issueAccess(input: IssueAccessTokenInput): Promise<string>;
  verifyAccess(token: string): Promise<VerifiedAccessToken>;
  generateRefresh(): { token: string; hash: string };
  hashRefresh(token: string): string;
}
