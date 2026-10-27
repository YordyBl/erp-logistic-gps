/**
 * Generates internal aggregate identifiers.
 *
 * The adapter is wired in the composition root (`crypto.randomUUID()` for the
 * pilot, UUIDv4), so use cases never import `node:crypto` directly.
 */
export interface IdGenerator {
  nextId(): string;
}
