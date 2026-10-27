import { normalizeEmail } from '../../../domain/entities/User.js';
import { InvalidCredentialsError } from '../../../domain/errors/IdentityError.js';
import type { SessionPolicy } from '../../../domain/policies/session-policy.js';
import type { Clock } from '../../ports/Clock.js';
import type { IdGenerator } from '../../ports/IdGenerator.js';
import type { PasswordHasher } from '../../ports/PasswordHasher.js';
import type { RefreshTokenStore } from '../../ports/RefreshTokenStore.js';
import type { TokenService } from '../../ports/TokenService.js';
import type { UserRepository } from '../../ports/UserRepository.js';
import { createSession } from '../shared/create-session.js';
import { parseLoginCommand } from './LoginCommand.js';
import type { LoginResult } from './LoginResult.js';

export interface LoginDependencies {
  readonly users: UserRepository;
  readonly passwordHasher: PasswordHasher;
  readonly tokenService: TokenService;
  readonly refreshTokens: RefreshTokenStore;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly sessionPolicy: SessionPolicy;
  /**
   * Hash of a throwaway secret. Verifying the presented password against it on
   * the unknown-email and disabled paths makes every rejection pay one Argon2
   * verification, so response time does not reveal whether the account exists
   * (T1 review finding R1-001).
   */
  readonly dummyPasswordHash: string;
}

/**
 * Authenticates a user and starts a device session.
 *
 * Unknown email, wrong password and disabled account all raise the same generic
 * error, so the endpoint cannot be used to enumerate accounts (ADR-003 §5).
 * Every failure path performs exactly one password verification, including the
 * paths where there is no stored user hash to check (R1-001).
 *
 * A successful login creates a new refresh family; every later rotation of that
 * family keeps the same `familyId`.
 */
export class LoginUseCase {
  constructor(private readonly dependencies: LoginDependencies) {}

  async execute(input: unknown): Promise<LoginResult> {
    const command = parseLoginCommand(input);
    const email = normalizeEmail(command.email);

    const user = await this.dependencies.users.findByEmail(
      command.organizationId,
      email,
    );

    if (user === null || user.status !== 'active') {
      // Constant work on the enumeration-sensitive paths: verify against a
      // throwaway hash so an unknown email costs the same as a wrong password.
      await this.dependencies.passwordHasher.verify(
        this.dependencies.dummyPasswordHash,
        command.password,
      );
      throw new InvalidCredentialsError();
    }

    const passwordMatches = await this.dependencies.passwordHasher.verify(
      user.passwordHash,
      command.password,
    );

    if (!passwordMatches) {
      throw new InvalidCredentialsError();
    }

    const now = this.dependencies.clock.now();
    const familyId = this.dependencies.idGenerator.nextId();

    return createSession(user, familyId, now, {
      tokenService: this.dependencies.tokenService,
      refreshTokens: this.dependencies.refreshTokens,
      idGenerator: this.dependencies.idGenerator,
      sessionPolicy: this.dependencies.sessionPolicy,
    });
  }
}
