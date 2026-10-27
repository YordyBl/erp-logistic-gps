import {
  buildIdentityModule,
  type IdentityModule,
} from '../../composition/composition-root.js';
import { Organization } from '../../domain/entities/Organization.js';
import { User, type UserRole } from '../../domain/entities/User.js';
import {
  FakePasswordHasher,
  FakeTokenService,
  FixedClock,
  SequentialIdGenerator,
} from './test-doubles.js';

/** Lima morning of 2026-10-27 (15:00Z is 10:00 in America/Lima). */
export const NOW = '2026-10-27T15:00:00.000Z';

export const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORGANIZATION_ID = '11111111-1111-4111-8111-111111111112';

export const ADMIN_ID = '22222222-2222-4222-8222-222222222221';
export const DISPATCHER_ID = '22222222-2222-4222-8222-222222222222';
export const DRIVER_ID = '22222222-2222-4222-8222-222222222223';

export interface IdentityTestContext {
  readonly module: IdentityModule;
  readonly clock: FixedClock;
  readonly hasher: FakePasswordHasher;
  readonly tokens: FakeTokenService;
  readonly ids: SequentialIdGenerator;
}

/**
 * Builds the module with in-memory adapters and deterministic doubles.
 *
 * The composition root owns the in-memory repositories, so tests exercise the
 * same wiring the demo uses instead of a parallel test-only implementation.
 */
export function buildTestModule(): IdentityTestContext {
  const clock = new FixedClock(NOW);
  const hasher = new FakePasswordHasher();
  const tokens = new FakeTokenService();
  const ids = new SequentialIdGenerator();

  const module = buildIdentityModule({
    passwordHasher: hasher,
    tokenService: tokens,
    clock,
    idGenerator: ids,
  });

  return { module, clock, hasher, tokens, ids };
}

export async function seedOrganization(
  context: IdentityTestContext,
  options: { id?: string; name?: string } = {},
): Promise<Organization> {
  const organization = Organization.create({
    id: options.id ?? ORGANIZATION_ID,
    name: options.name ?? 'Lima Express',
    createdAt: NOW,
  });

  await context.module.organizations.save(organization);
  return organization;
}

export interface SeedUserOptions {
  readonly id?: string;
  readonly organizationId?: string;
  readonly email?: string;
  readonly password?: string;
  readonly role?: UserRole;
  readonly status?: 'active' | 'disabled';
}

export async function seedUser(
  context: IdentityTestContext,
  options: SeedUserOptions = {},
): Promise<User> {
  const passwordHash = await context.hasher.hash(options.password ?? 'correct-horse-1');

  const user = User.create({
    id: options.id ?? ADMIN_ID,
    organizationId: options.organizationId ?? ORGANIZATION_ID,
    email: options.email ?? 'admin@lima.test',
    passwordHash,
    role: options.role ?? 'ADMIN',
    status: options.status ?? 'active',
    createdAt: NOW,
  });

  await context.module.users.save(user);
  return user;
}

/** Seeds the organization and one ADMIN actor, the minimum for create-user. */
export async function seedAdminContext(
  context: IdentityTestContext,
): Promise<void> {
  await seedOrganization(context);
  await seedUser(context);
}
