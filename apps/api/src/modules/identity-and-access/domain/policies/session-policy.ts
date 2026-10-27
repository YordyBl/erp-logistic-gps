/**
 * Ratified session lifetimes (architecture plan §7 and §11.7).
 *
 * The access token is a short-lived JWT; the refresh token is an opaque
 * 7-day rotating secret. The composition root may override the values from
 * configuration, but the defaults are the ratified policy and every adapter
 * receives them through this contract instead of hard-coding numbers.
 */
export const ACCESS_TOKEN_TTL_MINUTES = 15;
export const REFRESH_TOKEN_TTL_DAYS = 7;
export const ACCESS_TOKEN_TTL_SECONDS = ACCESS_TOKEN_TTL_MINUTES * 60;
export const REFRESH_TOKEN_TTL_SECONDS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

export interface SessionPolicy {
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = Object.freeze({
  accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlSeconds: REFRESH_TOKEN_TTL_SECONDS,
});

export interface SessionPolicyInput {
  readonly accessTokenTtlMinutes: number;
  readonly refreshTokenTtlDays: number;
}

/** Builds a validated policy from configuration values. */
export function createSessionPolicy(input: SessionPolicyInput): SessionPolicy {
  requirePositiveInteger(input.accessTokenTtlMinutes, 'accessTokenTtlMinutes');
  requirePositiveInteger(input.refreshTokenTtlDays, 'refreshTokenTtlDays');

  return {
    accessTokenTtlSeconds: input.accessTokenTtlMinutes * 60,
    refreshTokenTtlSeconds: input.refreshTokenTtlDays * 24 * 60 * 60,
  };
}

/** Adds a duration to an ISO-8601 instant and returns a new ISO-8601 instant. */
export function addSeconds(instant: string, seconds: number): string {
  const parsed = Date.parse(instant);

  if (Number.isNaN(parsed)) {
    throw new Error(`Cannot add seconds to invalid instant "${instant}"`);
  }

  return new Date(parsed + seconds * 1000).toISOString();
}

/**
 * Expiry is inclusive: at `expiresAt` the token is already unusable, matching
 * the JWT `exp` semantics.
 */
export function isExpired(expiresAt: string, now: string): boolean {
  return Date.parse(now) >= Date.parse(expiresAt);
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}
