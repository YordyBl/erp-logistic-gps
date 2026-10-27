/**
 * Generates internal identifiers (user, organization, token row, JWT `jti`).
 *
 * The adapter is `crypto.randomUUID()` (UUIDv4) behind this port so the
 * UUIDv4-versus-UUIDv7 decision remains a composition change (ADR-007).
 */
export interface IdGenerator {
  nextId(): string;
}
