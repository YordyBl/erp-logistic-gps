import { argon2id, hash, verify } from 'argon2';

import type { PasswordHasher } from '../../application/ports/PasswordHasher.js';

/**
 * Argon2id password hashing (ADR-003 §5).
 *
 * Parameters follow the OWASP baseline for interactive logins: 19 MiB of
 * memory, two iterations and one lane. They are fixed here rather than read
 * from the environment because a weaker deployment value would silently weaken
 * every stored hash; changing them requires a deliberate migration plan plus
 * `argon2.needsRehash` handling, which is a follow-up.
 *
 * `verify` returns `false` for malformed hashes so a corrupted row is rejected
 * as bad credentials instead of failing the request with a 500.
 */
export class Argon2PasswordHasher implements PasswordHasher {
  private static readonly options = {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  } as const;

  async hash(password: string): Promise<string> {
    return hash(password, Argon2PasswordHasher.options);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}
