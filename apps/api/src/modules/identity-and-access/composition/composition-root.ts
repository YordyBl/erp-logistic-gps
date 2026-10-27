import type { DataSource } from 'typeorm';

import type { AuthConfig } from '../../../config/config.js';
import { SystemClock, type Clock } from '../../../shared/clock.js';
import { generateUuidV4 } from '../../../shared/ids.js';
import type { OrganizationRepository } from '../application/ports/OrganizationRepository.js';
import type { PasswordHasher } from '../application/ports/PasswordHasher.js';
import type {
  RefreshTokenStore,
  StoredRefreshToken,
} from '../application/ports/RefreshTokenStore.js';
import type { TokenService } from '../application/ports/TokenService.js';
import type { UserRepository } from '../application/ports/UserRepository.js';
import { CreateUserUseCase } from '../application/use-cases/create-user/CreateUserUseCase.js';
import { LoginUseCase } from '../application/use-cases/login/LoginUseCase.js';
import { LogoutUseCase } from '../application/use-cases/logout/LogoutUseCase.js';
import { RefreshSessionUseCase } from '../application/use-cases/refresh-session/RefreshSessionUseCase.js';
import { RegisterOrganizationUseCase } from '../application/use-cases/register-organization/RegisterOrganizationUseCase.js';
import { Organization } from '../domain/entities/Organization.js';
import type { User } from '../domain/entities/User.js';
import {
  createSessionPolicy,
  DEFAULT_SESSION_POLICY,
  type SessionPolicy,
} from '../domain/policies/session-policy.js';
import type { IdGenerator } from '../application/ports/IdGenerator.js';

/**
 * In-memory organization repository for tests and the demo composition.
 *
 * Deliberately not a production adapter: data disappears with the process.
 */
export class InMemoryOrganizationRepository implements OrganizationRepository {
  private readonly organizations = new Map<string, Organization>();

  async save(organization: Organization): Promise<void> {
    this.organizations.set(organization.id, organization);
  }

  async findById(organizationId: string): Promise<Organization | null> {
    return this.organizations.get(organizationId) ?? null;
  }
}

/**
 * In-memory user repository.
 *
 * Mirrors the port contract: `findByEmail` is tenant-scoped and emails are
 * already normalized by the domain.
 */
export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();

  async save(user: User): Promise<void> {
    this.users.set(user.id, user);
  }

  async findById(userId: string): Promise<User | null> {
    return this.users.get(userId) ?? null;
  }

  async findByEmail(organizationId: string, email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.organizationId === organizationId && user.email === email) {
        return user;
      }
    }

    return null;
  }
}

/**
 * In-memory refresh token store with the same single-winner revocation
 * semantics as the PostgreSQL adapter.
 */
export class InMemoryRefreshTokenStore implements RefreshTokenStore {
  private readonly tokens = new Map<string, StoredRefreshToken>();

  async save(token: StoredRefreshToken): Promise<void> {
    this.tokens.set(token.id, token);
  }

  async findByHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    for (const token of this.tokens.values()) {
      if (token.tokenHash === tokenHash) {
        return token;
      }
    }

    return null;
  }

  async revokeOne(tokenId: string, revokedAt: string): Promise<boolean> {
    const token = this.tokens.get(tokenId);

    if (token === undefined || token.revokedAt !== null) {
      return false;
    }

    this.tokens.set(tokenId, { ...token, revokedAt });
    return true;
  }

  async revokeFamily(familyId: string, revokedAt: string): Promise<void> {
    for (const [tokenId, token] of this.tokens) {
      if (token.familyId === familyId && token.revokedAt === null) {
        this.tokens.set(tokenId, { ...token, revokedAt });
      }
    }
  }
}

export class CryptoIdGenerator implements IdGenerator {
  nextId(): string {
    return generateUuidV4();
  }
}

export interface IdentityModuleDependencies {
  readonly passwordHasher: PasswordHasher;
  readonly tokenService: TokenService;
  readonly userRepository?: UserRepository;
  readonly organizationRepository?: OrganizationRepository;
  readonly refreshTokenStore?: RefreshTokenStore;
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
}

/**
 * Composition root for the `identity-and-access` module.
 *
 * Password hasher and token service are required because neither can have a
 * safe default: a default secret or a reversible hasher would be a security
 * defect. Tests inject deterministic doubles; the process factory below wires
 * the Argon2id/jose adapters from validated configuration.
 */
export function buildIdentityModule(
  dependencies: IdentityModuleDependencies,
): IdentityModule {
  const users = dependencies.userRepository ?? new InMemoryUserRepository();
  const organizations =
    dependencies.organizationRepository ?? new InMemoryOrganizationRepository();
  const refreshTokens =
    dependencies.refreshTokenStore ?? new InMemoryRefreshTokenStore();
  const clock = dependencies.clock ?? new SystemClock();
  const idGenerator = dependencies.idGenerator ?? new CryptoIdGenerator();
  const sessionPolicy = dependencies.sessionPolicy ?? DEFAULT_SESSION_POLICY;

  return {
    registerOrganization: new RegisterOrganizationUseCase({
      organizations,
      idGenerator,
      clock,
    }),
    createUser: new CreateUserUseCase({
      users,
      organizations,
      passwordHasher: dependencies.passwordHasher,
      idGenerator,
      clock,
    }),
    login: new LoginUseCase({
      users,
      passwordHasher: dependencies.passwordHasher,
      tokenService: dependencies.tokenService,
      refreshTokens,
      idGenerator,
      clock,
      sessionPolicy,
    }),
    refreshSession: new RefreshSessionUseCase({
      users,
      tokenService: dependencies.tokenService,
      refreshTokens,
      idGenerator,
      clock,
      sessionPolicy,
    }),
    logout: new LogoutUseCase({
      tokenService: dependencies.tokenService,
      refreshTokens,
      clock,
    }),
    users,
    organizations,
    refreshTokens,
    tokenService: dependencies.tokenService,
    passwordHasher: dependencies.passwordHasher,
  };
}

export interface TypeOrmIdentityModuleOptions {
  readonly clock?: Clock;
  readonly idGenerator?: IdGenerator;
  readonly passwordHasher?: PasswordHasher;
  readonly tokenService?: TokenService;
  readonly sessionPolicy?: SessionPolicy;
}

/**
 * Composes the module with PostgreSQL adapters and the real security adapters.
 *
 * Adapters are imported dynamically so unit tests that import this file do not
 * load TypeORM decorators or the native Argon2 binding. The caller owns the
 * data source lifecycle; this factory only wires ports.
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

  return buildIdentityModule({
    userRepository: new UserTypeOrmRepository(dataSource),
    organizationRepository: new OrganizationTypeOrmRepository(dataSource),
    refreshTokenStore: new RefreshTokenTypeOrmStore(dataSource),
    passwordHasher: options.passwordHasher ?? new Argon2PasswordHasher(),
    tokenService:
      options.tokenService ??
      new JwtTokenService({
        secret: auth.jwtSecret,
        issuer: auth.jwtIssuer,
        audience: auth.jwtAudience,
      }),
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
