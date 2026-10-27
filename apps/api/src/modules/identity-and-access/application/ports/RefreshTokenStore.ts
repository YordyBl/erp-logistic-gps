/**
 * A stored refresh token. Only the hash is persisted; the raw token exists in
 * the client cookie and in memory during the request (ADR-003 §3).
 *
 * `familyId` identifies one device session chain. A successful rotation issues
 * a new row in the same family and revokes the presented row; reuse of any
 * revoked row revokes the whole family.
 */
export interface StoredRefreshToken {
  readonly id: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly familyId: string;
  /** SHA-256 of the opaque refresh token, hex encoded. */
  readonly tokenHash: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

/**
 * Persistence contract for rotating refresh tokens.
 *
 * `revokeOne` must be atomic: it returns `true` only when this call changed a
 * live token to revoked. That single-winner guarantee is what makes rotation
 * consume a token exactly once; a concurrent second refresh sees `false` and is
 * treated as reuse. `tokenHash` is globally unique, so `findByHash` is not
 * tenant-scoped: the hash itself is a 256-bit secret.
 */
export interface RefreshTokenStore {
  save(token: StoredRefreshToken): Promise<void>;
  findByHash(tokenHash: string): Promise<StoredRefreshToken | null>;
  revokeOne(tokenId: string, revokedAt: string): Promise<boolean>;
  revokeFamily(familyId: string, revokedAt: string): Promise<void>;
}
