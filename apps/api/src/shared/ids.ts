import { randomUUID } from 'node:crypto';

/**
 * Internal identifier generation.
 *
 * The pilot uses UUIDv4 through `crypto.randomUUID()`. The UUIDv4-versus-UUIDv7
 * decision is still pending in the architecture plan (§11.9); keeping the
 * generator behind this helper makes that change local when it is ratified.
 */
export function generateUuidV4(): string {
  return randomUUID();
}

/**
 * RFC 4122 shape, any version.
 *
 * The domain accepts any UUID version so a later UUIDv7 decision does not
 * require entity changes, while still rejecting hand-written identifiers.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
