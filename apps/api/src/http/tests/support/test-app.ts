import { randomBytes, randomUUID } from 'node:crypto';

import type { Express } from 'express';
import { pino, type Logger } from 'pino';

import {
  loadAuthConfig,
  type LoginRateLimitConfig,
} from '../../../config/config.js';
import {
  buildCustomersModule,
} from '../../../modules/customers/composition/composition-root.js';
import type { DeliveryOrderRepository } from '../../../modules/delivery-orders/application/ports/DeliveryOrderRepository.js';
import {
  createDeliveryOrdersModule,
  InMemoryEventPublisher,
  type DeliveryOrdersModule,
} from '../../../modules/delivery-orders/composition/composition-root.js';
import {
  buildDriversModule,
} from '../../../modules/drivers/composition/composition-root.js';
import {
  buildVehiclesModule,
} from '../../../modules/vehicles/composition/composition-root.js';
import {
  FixedClock,
  SequentialIdGenerator,
} from '../../../modules/delivery-orders/tests/support/test-doubles.js';
import {
  TEST_DUMMY_PASSWORD_HASH,
} from '../../../modules/identity-and-access/tests/support/fixtures.js';
import {
  buildInMemoryIdentityModule,
} from '../../../modules/identity-and-access/tests/support/in-memory-adapters.js';
import { FakePasswordHasher } from '../../../modules/identity-and-access/tests/support/test-doubles.js';
import { SystemClock } from '../../../shared/clock.js';
import { buildApp } from '../../app.js';
import type { ReadinessCheck } from '../../routes/health.routes.js';
import type { IdentityModule } from '../../../modules/identity-and-access/composition/composition-root.js';
import { Organization } from '../../../modules/identity-and-access/domain/entities/Organization.js';
import { User, type UserRole } from '../../../modules/identity-and-access/domain/entities/User.js';
import { JwtTokenService } from '../../../modules/identity-and-access/infrastructure/security/jwt-token-service.js';

export const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
export const CREATED_AT = '2026-10-26T15:00:00.000Z';
export const FIRST_ORDER_ID = '00000000-0000-4000-8000-000000000001';

export const ADMIN_ID = '33333333-3333-4333-8333-333333333331';
export const DISPATCHER_ID = '33333333-3333-4333-8333-333333333332';
export const DRIVER_ID = '33333333-3333-4333-8333-333333333333';
export const OTHER_ADMIN_ID = '44444444-4444-4444-8444-444444444441';

export const ADMIN_EMAIL = 'admin@lima.test';
export const DISPATCHER_EMAIL = 'dispatcher@lima.test';
export const DRIVER_EMAIL = 'driver@lima.test';
export const OTHER_ADMIN_EMAIL = 'admin@callao.test';

export const TEST_PASSWORD = 'correct-horse-1';

/** Random per run: a committed test secret would be a real credential. */
export const TEST_JWT_SECRET = randomBytes(32).toString('hex');
export const TEST_JWT_ISSUER = 'erp-logistic-api-test';
export const TEST_JWT_AUDIENCE = 'erp-logistic-web-test';

/**
 * Default login rate limit, taken from the validated configuration instead of
 * repeating the literals: the HTTP tests must fail if the documented defaults
 * drift (R2-dup-rate-limit-defaults).
 */
export const DEFAULT_LOGIN_RATE_LIMIT: LoginRateLimitConfig =
  loadAuthConfig({ JWT_SECRET: TEST_JWT_SECRET }).loginRateLimit;

/**
 * Valid create payload with the same shape the application command schema
 * accepts. Values are deliberately not pre-normalized (lowercase public code and
 * package codes) so the tests observe the documented normalization.
 */
export function validOrderBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    publicCode: 'ord-2026-0001',
    recipient: { name: 'Ana Torres', phone: '+51 987 654 321' },
    deliveryAddress: {
      addressLine: 'Av. Javier Prado Este 1234',
      district: 'San Borja',
      latitude: -12.0975,
      longitude: -77.0023,
    },
    packages: [
      { code: 'pkg-001', description: 'Sealed box', weightKg: 2.5 },
      { code: 'pkg-002', description: 'Document envelope' },
    ],
    ...overrides,
  };
}

export interface TestAppOptions {
  readonly repository?: DeliveryOrderRepository;
  readonly readiness?: ReadinessCheck;
  readonly logger?: Logger;
  readonly cookieSecure?: boolean;
  readonly loginRateLimit?: LoginRateLimitConfig;
}

export interface SeedTestUserOptions {
  readonly id?: string;
  readonly organizationId?: string;
  readonly email?: string;
  readonly password?: string;
  readonly role?: UserRole;
  readonly status?: 'active' | 'disabled';
}

export interface TestApp {
  readonly app: Express;
  readonly logger: Logger;
  readonly module: DeliveryOrdersModule;
  readonly identity: IdentityModule;
  readonly hasher: FakePasswordHasher;
  readonly tokenService: JwtTokenService;
  seedOrganization(options?: { id?: string; name?: string }): Promise<Organization>;
  seedUser(options?: SeedTestUserOptions): Promise<User>;
  /** Access token for an already seeded user, without going through login. */
  signIn(user: Pick<User, 'id' | 'organizationId' | 'role'>): Promise<string>;
}

/**
 * Builds the real Express app with in-memory adapters, a real jose token
 * service and deterministic delivery-order time and ids.
 *
 * No database or network is involved. The identity module uses the same ports
 * as production, so JWT verification, refresh rotation and rate limiting are
 * exercised through their real implementations (only the repositories and the
 * password hasher are in-memory/test doubles).
 */
export function buildTestApp(options: TestAppOptions = {}): TestApp {
  const logger = options.logger ?? pino({ level: 'silent' });
  const clock = new SystemClock();
  const hasher = new FakePasswordHasher();
  const tokenService = new JwtTokenService({
    secret: TEST_JWT_SECRET,
    issuer: TEST_JWT_ISSUER,
    audience: TEST_JWT_AUDIENCE,
  });

  const identity = buildInMemoryIdentityModule({
    passwordHasher: hasher,
    tokenService,
    dummyPasswordHash: TEST_DUMMY_PASSWORD_HASH,
    clock,
    idGenerator: new SequentialIdGenerator('33333333-3333-4333-8333-'),
  });

  const module = createDeliveryOrdersModule({
    clock: new FixedClock(CREATED_AT),
    idGenerator: new SequentialIdGenerator(),
    eventPublisher: new InMemoryEventPublisher(),
    ...(options.repository === undefined ? {} : { repository: options.repository }),
  });

  const app = buildApp({
    deliveryOrders: module,
    auth: {
      login: identity.login,
      refreshSession: identity.refreshSession,
      logout: identity.logout,
      createUser: identity.createUser,
      users: identity.users,
      tokenService: identity.tokenService,
      cookie: {
        secure: options.cookieSecure ?? false,
        maxAgeSeconds: identity.sessionPolicy.refreshTokenTtlSeconds,
      },
      loginRateLimit: options.loginRateLimit ?? DEFAULT_LOGIN_RATE_LIMIT,
    },
    catalogs: {
      customers: buildCustomersModule(),
      drivers: buildDriversModule(),
      vehicles: buildVehiclesModule(),
    },
    readiness: options.readiness ?? (async () => undefined),
    logger,
  });

  async function seedOrganization(
    seedOptions: { id?: string; name?: string } = {},
  ): Promise<Organization> {
    const organization = Organization.create({
      id: seedOptions.id ?? ORGANIZATION_ID,
      name: seedOptions.name ?? 'Lima Express',
      createdAt: CREATED_AT,
    });

    await identity.organizations.save(organization);
    return organization;
  }

  async function seedUser(seedOptions: SeedTestUserOptions = {}): Promise<User> {
    const user = User.create({
      id: seedOptions.id ?? ADMIN_ID,
      organizationId: seedOptions.organizationId ?? ORGANIZATION_ID,
      email: seedOptions.email ?? ADMIN_EMAIL,
      passwordHash: await hasher.hash(seedOptions.password ?? TEST_PASSWORD),
      role: seedOptions.role ?? 'ADMIN',
      status: seedOptions.status ?? 'active',
      createdAt: CREATED_AT,
    });

    await identity.users.save(user);
    return user;
  }

  async function signIn(
    user: Pick<User, 'id' | 'organizationId' | 'role'>,
  ): Promise<string> {
    return tokenService.issueAccess({
      userId: user.id,
      organizationId: user.organizationId,
      role: user.role,
      jti: randomUUID(),
      exp: Math.floor(Date.now() / 1000) + identity.sessionPolicy.accessTokenTtlSeconds,
    });
  }

  return {
    app,
    logger,
    module,
    identity,
    hasher,
    tokenService,
    seedOrganization,
    seedUser,
    signIn,
  };
}

/**
 * Repository whose every operation fails, used to prove that an unexpected
 * adapter failure becomes a generic 500 instead of leaking internals.
 */
export function createFailingRepository(
  message = 'database connection lost',
): DeliveryOrderRepository {
  const fail = async (): Promise<never> => {
    throw new Error(message);
  };

  return {
    save: fail,
    findById: fail,
    findByPublicCode: fail,
    list: fail,
    cancel: fail,
    findStatusHistory: fail,
  };
}

/** `Authorization` header value for a bearer token. */
export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
