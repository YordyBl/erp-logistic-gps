import { randomBytes } from 'node:crypto';

import type { DataSource } from 'typeorm';

import type { AuthConfig } from '../../../config/config.js';
import { SystemClock, type Clock } from '../../../shared/clock.js';
import { generateUuidV4 } from '../../../shared/ids.js';
import type { OrganizationRepository } from '../application/ports/OrganizationRepository.js';
import type { PasswordHasher } from '../application/ports/PasswordHasher.js';
import type { RefreshTokenStore } from '../application/ports/RefreshTokenStore.js';
import type { TokenService } from '../application/ports/TokenService.js';
import type { UserRepository } from '../application/ports/UserRepository.js';
import { CreateUserUseCase } from '../application/use-cases/create-user/CreateUserUseCase.js';
import { LoginUseCase } from '../application/use-cases/login/LoginUseCase.js';
import { LogoutUseCase } from '../application/use-cases/logout/LogoutUseCase.js';
import { RefreshSessionUseCase } from '../application/use-cases/refresh-session/RefreshSessionUseCase.js';
import { RegisterOrganizationUseCase } from '../application/use-cases/register-organization/RegisterOrganizationUseCase.js';
import {
  createSessionPolicy,
  DEFAULT_SESSION_POLICY,
  type SessionPolicy,
} from '../domain/policies/session-policy.js';
import type { IdGenerator } from '../application/ports/IdGenerator.js';

/**
 * Composition root for the `identity-and-access` module.
 *
 * Every persistence adapter is required. There is deliberately no in-memory
 * default: a production composition that forgot to pass a repository would
 * work until the process restarted and then lose data, which is worse than a
 * startup failure. Tests wire in-memory adapters explicitly through
 * `buildInMemoryIdentityModule` below.
 *
 * Password hasher, token service and dummy password hash are also required
 * because none can have a safe default: a default secret or a reversible hasher
 * would be a security defect, and an empty dummy hash would silently disable
 * the constant-time login path.
 */
export interface IdentityModuleDependencies {
  readonly userRepository: UserRepository;
  readonly organizationRepository: OrganizationRepository;
  readonly refreshTokenStore: RefreshTokenStore;
  readonly passwordHasher: PasswordHasher;
  readonly tokenService: TokenService;
  /**
   * Argon2id hash of a throwaway secret. `LoginUseCase` verifies against it
   * when the email is unknown or the account is disabled, so both failure paths
   * pay one Argon2 verification (T1 review finding R1-001).
   */
  readonly dummyPasswordHash: string;
  readonly clock?: Clock;
  readonly idGenerator?: IdGenerator;
  readonly sessionPolicy?: SessionPolicy;
}

export interface IdentityModule {
  readonly registerOrganization: RegisterOrganizationUseCase;
  readonly createUser: CreateUserUseCase;
  readonly login: LoginUseCase;
  readonly refreshSession: RefreshSessionUseCase;
  readonly logout: LogoutUseCase;
  readonly users: UserRepository;
  readonly organizations: OrganizationRepository;
  readonly refreshTokens: RefreshTokenStore;
  readonly tokenService: TokenService;
  readonly passwordHasher: PasswordHasher;
  readonly sessionPolicy: SessionPolicy;
}

export class CryptoIdGenerator implements IdGenerator {
  nextId(): string {
    return generateUuidV4();
  }
}

export function buildIdentityModule(
  dependencies: IdentityModuleDependencies,
): IdentityModule {
  const clock = dependencies.clock ?? new SystemClock();
  const idGenerator = dependencies.idGenerator ?? new CryptoIdGenerator();
  const sessionPolicy = dependencies.sessionPolicy ?? DEFAULT_SESSION_POLICY;

  return {
    registerOrganization: new RegisterOrganizationUseCase({
      organizations: dependencies.organizationRepository,
      idGenerator,
      clock,
    }),
    createUser: new CreateUserUseCase({
      users: dependencies.userRepository,
      organizations: dependencies.organizationRepository,
      passwordHasher: dependencies.passwordHasher,
      idGenerator,
      clock,
    }),
    login: new LoginUseCase({
      users: dependencies.userRepository,
      passwordHasher: dependencies.passwordHasher,
      tokenService: dependencies.tokenService,
      refreshTokens: dependencies.refreshTokenStore,
      idGenerator,
      clock,
      sessionPolicy,
      dummyPasswordHash: dependencies.dummyPasswordHash,
    }),
    refreshSession: new RefreshSessionUseCase({
      users: dependencies.userRepository,
      tokenService: dependencies.tokenService,
      refreshTokens: dependencies.refreshTokenStore,
      idGenerator,
      clock,
      sessionPolicy,
    }),
    logout: new LogoutUseCase({
      tokenService: dependencies.tokenService,
      refreshTokens: dependencies.refreshTokenStore,
      clock,
    }),
    users: dependencies.userRepository,
    organizations: dependencies.organizationRepository,
    refreshTokens: dependencies.refreshTokenStore,
    tokenService: dependencies.tokenService,
    passwordHasher: dependencies.passwordHasher,
    sessionPolicy,
  };
}

export interface TypeOrmIdentityModuleOptions {
  readonly clock?: Clock;
  readonly idGenerator?: IdGenerator;
  readonly passwordHasher?: PasswordHasher;
  readonly tokenService?: TokenService;
  readonly sessionPolicy?: SessionPolicy;
  /** Precomputed dummy hash, for tests that inject a fake hasher. */
  readonly dummyPasswordHash?: string;
}

/**
 * Production composition: PostgreSQL for persistence, Argon2id/jose for
 * security.
 *
 * Adapters are imported dynamically so unit tests that import this file do not
 * load TypeORM decorators or the native Argon2 binding. The caller owns the
 * data source lifecycle; this factory only wires ports. All three repositories
 * are constructed here and passed explicitly, so the module cannot fall back to
 * a process-local store.
 */
export async function createIdentityModuleFromDataSource(
  dataSource: DataSource,
  auth: AuthConfig,
  options: TypeOrmIdentityModuleOptions = {},
): Promise<IdentityModule> {
  const [
    { UserTypeOrmRepository },
    { OrganizationTypeOrmRepository },
    { RefreshTokenTypeOrmStore },
    { Argon2PasswordHasher },
    { JwtTokenService },
  ] = await Promise.all([
    import('../infrastructure/persistence/UserTypeOrmRepository.js'),
    import('../infrastructure/persistence/OrganizationTypeOrmRepository.js'),
    import('../infrastructure/persistence/RefreshTokenTypeOrmStore.js'),
    import('../infrastructure/security/argon2-password-hasher.js'),
    import('../infrastructure/security/jwt-token-service.js'),
  ]);

  const passwordHasher = options.passwordHasher ?? new Argon2PasswordHasher();

  // Hashing a random throwaway secret once at startup gives the login use case a
  // real Argon2 hash to verify against, so an unknown email costs the same as a
  // wrong password without storing a password anywhere.
  const dummyPasswordHash =
    options.dummyPasswordHash ??
    (await passwordHasher.hash(randomBytes(32).toString('hex')));

  return buildIdentityModule({
    userRepository: new UserTypeOrmRepository(dataSource),
    organizationRepository: new OrganizationTypeOrmRepository(dataSource),
    refreshTokenStore: new RefreshTokenTypeOrmStore(dataSource),
    passwordHasher,
    tokenService:
      options.tokenService ??
      new JwtTokenService({
        secret: auth.jwtSecret,
        issuer: auth.jwtIssuer,
        audience: auth.jwtAudience,
      }),
    dummyPasswordHash,
    sessionPolicy:
      options.sessionPolicy ??
      createSessionPolicy({
        accessTokenTtlMinutes: auth.accessTokenTtlMinutes,
        refreshTokenTtlDays: auth.refreshTokenTtlDays,
      }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.idGenerator === undefined
      ? {}
      : { idGenerator: options.idGenerator }),
  });
}
