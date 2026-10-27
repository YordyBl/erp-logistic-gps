import type { Clock } from '../../application/ports/Clock.js';
import type { IdGenerator } from '../../application/ports/IdGenerator.js';
import type { PasswordHasher } from '../../application/ports/PasswordHasher.js';
import type {
  IssueAccessTokenInput,
  TokenService,
  VerifiedAccessToken,
} from '../../application/ports/TokenService.js';
import { InvalidTokenError } from '../../domain/errors/IdentityError.js';

/**
 * Controllable clock for session tests.
 *
 * Refresh rotation, expiry and reuse detection are all time dependent, so the
 * suite needs to move time forward without waiting.
 */
export class FixedClock implements Clock {
  constructor(private instant: string) {}

  now(): string {
    return this.instant;
  }

  advanceSeconds(seconds: number): void {
    this.instant = new Date(Date.parse(this.instant) + seconds * 1000).toISOString();
  }
}

/**
 * Deterministic UUIDv4-shaped identifier generator.
 *
 * The domain rejects identifiers that are not UUIDs, so the fake keeps the
 * shape while making assertions readable.
 */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = '00000000-0000-4000-8000-') {}

  nextId(): string {
    this.counter += 1;
    return `${this.prefix}${String(this.counter).padStart(12, '0')}`;
  }
}

/**
 * Reversible password hasher for unit tests.
 *
 * It is deliberately not a hash: tests assert that the plaintext never leaves
 * the application layer and that `verify` is consulted, not that Argon2 works.
 * The real Argon2id adapter has its own tests.
 */
export class FakePasswordHasher implements PasswordHasher {
  private readonly plaintexts: string[] = [];

  async hash(password: string): Promise<string> {
    this.plaintexts.push(password);
    return `hashed:${password}`;
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    return passwordHash === `hashed:${password}`;
  }

  get received(): readonly string[] {
    return this.plaintexts;
  }
}

/**
 * Deterministic access/refresh token service for unit tests.
 *
 * Access tokens are symbolic (`access.<jti>`) and refresh tokens are counted
 * (`refresh-1`, `refresh-2`, ...), so tests can assert rotation order. Hashes
 * are stable functions of the raw token.
 */
export class FakeTokenService implements TokenService {
  private counter = 0;
  private readonly accessInputs: IssueAccessTokenInput[] = [];

  async issueAccess(input: IssueAccessTokenInput): Promise<string> {
    this.accessInputs.push(input);
    return `access.${input.jti}`;
  }

  async verifyAccess(): Promise<VerifiedAccessToken> {
    throw new InvalidTokenError('FakeTokenService does not verify access tokens');
  }

  generateRefresh(): { token: string; hash: string } {
    this.counter += 1;
    const token = `refresh-${this.counter}`;
    return { token, hash: `hash:${token}` };
  }

  hashRefresh(token: string): string {
    return `hash:${token}`;
  }

  get issuedAccess(): readonly IssueAccessTokenInput[] {
    return this.accessInputs;
  }
}
