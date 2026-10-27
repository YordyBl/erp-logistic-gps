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
}

/**
 * Authenticates a user and starts a device session.
 *
 * Unknown email, wrong password and disabled account all raise the same generic
 * error, so the endpoint cannot be used to enumerate accounts (ADR-003 §5).
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
