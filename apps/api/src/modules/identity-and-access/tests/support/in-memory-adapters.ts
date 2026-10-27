import type { OrganizationRepository } from '../../application/ports/OrganizationRepository.js';
import type {
  RefreshTokenStore,
  StoredRefreshToken,
} from '../../application/ports/RefreshTokenStore.js';
import type { UserRepository } from '../../application/ports/UserRepository.js';
import type { Clock } from '../../application/ports/Clock.js';
import type { IdGenerator } from '../../application/ports/IdGenerator.js';
import type { PasswordHasher } from '../../application/ports/PasswordHasher.js';
import type { TokenService } from '../../application/ports/TokenService.js';
import {
  buildIdentityModule,
  type IdentityModule,
} from '../../composition/composition-root.js';
import type { SessionPolicy } from '../../domain/policies/session-policy.js';
import type { Organization } from '../../domain/entities/Organization.js';
import type { User } from '../../domain/entities/User.js';

/**
 * In-memory adapters for tests.
 *
 * They live under `tests/support` on purpose: the production composition
 * (`createIdentityModuleFromDataSource`) requires every PostgreSQL adapter, so
 * a missing adapter fails at the composition boundary instead of silently
 * swapping in a process-local store (T1 review finding R1-composition).
 *
 * `InMemoryRefreshTokenStore` mirrors the PostgreSQL single-winner revocation
 * semantics: `revokeOne` returns `true` only when this call changed a live
 * token, which is what makes reuse detection testable without a database.
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

/** In-memory refresh-token store with the production revocation contract. */
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

/**
 * Explicitly named test factory.
 *
 * This is the only way to get the module backed by in-memory adapters. The
 * production factory (`createIdentityModuleFromDataSource`) requires the
 * PostgreSQL adapters, so a missing adapter fails at composition time instead
 * of silently falling back to a store that loses data on restart.
 */
export interface InMemoryIdentityModuleOptions {
  readonly passwordHasher: PasswordHasher;
  readonly tokenService: TokenService;
  readonly dummyPasswordHash: string;
  readonly clock?: Clock;
  readonly idGenerator?: IdGenerator;
  readonly sessionPolicy?: SessionPolicy;
}

export function buildInMemoryIdentityModule(
  options: InMemoryIdentityModuleOptions,
): IdentityModule {
  return buildIdentityModule({
    userRepository: new InMemoryUserRepository(),
    organizationRepository: new InMemoryOrganizationRepository(),
    refreshTokenStore: new InMemoryRefreshTokenStore(),
    passwordHasher: options.passwordHasher,
    tokenService: options.tokenService,
    dummyPasswordHash: options.dummyPasswordHash,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.idGenerator === undefined
      ? {}
      : { idGenerator: options.idGenerator }),
    ...(options.sessionPolicy === undefined
      ? {}
      : { sessionPolicy: options.sessionPolicy }),
  });
}
