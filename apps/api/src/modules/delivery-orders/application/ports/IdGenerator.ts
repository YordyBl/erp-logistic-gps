/**
 * Generates internal aggregate identifiers.
 *
 * The adapter is wired in the composition root (`crypto.randomUUID()` for the
 * pilot, UUIDv4). The UUIDv4-versus-UUIDv7 decision remains pending (architecture
 * plan §11.9), so use cases depend on this port rather than on `node:crypto`.
 */
export interface IdGenerator {
  nextId(): string;
}
