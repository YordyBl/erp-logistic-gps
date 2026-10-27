import 'reflect-metadata';

import type { DataSource } from 'typeorm';

import {
  applyRuntimeTimezone,
  loadAuthConfig,
  loadConfig,
} from '../config/config.js';
import { composeApiModules } from '../infrastructure/composition/composition-root.js';
import { createDataSource } from '../infrastructure/database/data-source.js';
import {
  CryptoIdGenerator,
  type IdentityModule,
} from '../modules/identity-and-access/composition/composition-root.js';
import { User } from '../modules/identity-and-access/domain/entities/User.js';
import { OrganizationEntity } from '../modules/identity-and-access/infrastructure/persistence/entities/OrganizationEntity.js';
import { SystemClock, type Clock } from '../shared/clock.js';

/**
 * Demo seed for Phase 1 (S9).
 *
 * Creates one demo organization plus an ADMIN, a DISPATCHER and a DRIVER user,
 * all with documented demo-only credentials. It is a code-only bootstrap path:
 * `registerOrganization` is never exposed over HTTP (T1 review finding
 * R1-002), and the first ADMIN cannot come from the ADMIN-only `createUser`
 * use case because no ADMIN exists yet — the seed is that bootstrap.
 *
 * Wiring is the production composition root, not a test double: PostgreSQL
 * repositories, the Argon2id hasher and the jose token service are the same
 * objects the API uses, so seeded hashes are real and directly usable for
 * login.
 *
 * Idempotency:
 * - the organization is matched by name (oldest first) and registered through
 *   the use case only when it is absent;
 * - each user is matched by email inside that organization and skipped when it
 *   already exists, so a second run neither fails nor duplicates rows.
 *
 * Demo credentials are published in `README.md`; this script must never run
 * against a production database (it refuses when `NODE_ENV=production`).
 */

const DEMO_ORGANIZATION_NAME = 'Lima Demo Logistics';

interface DemoUserSeed {
  readonly role: 'ADMIN' | 'DISPATCHER' | 'DRIVER';
  readonly email: string;
  readonly password: string;
}

/**
 * Documented demo credentials. The password policy applies (at least 10
 * characters, one letter and one digit), and they are intentionally weak
 * because they are public.
 */
const DEMO_ADMIN: DemoUserSeed = {
  role: 'ADMIN',
  email: 'admin@demo.lima',
  password: 'Admin-demo-1',
};

const DEMO_DISPATCHER: DemoUserSeed = {
  role: 'DISPATCHER',
  email: 'dispatcher@demo.lima',
  password: 'Dispatcher-demo-1',
};

const DEMO_DRIVER: DemoUserSeed = {
  role: 'DRIVER',
  email: 'driver@demo.lima',
  password: 'Driver-demo-1',
};

const DEMO_USERS: readonly DemoUserSeed[] = [
  DEMO_ADMIN,
  DEMO_DISPATCHER,
  DEMO_DRIVER,
];

interface SeededUser {
  readonly seed: DemoUserSeed;
  readonly created: boolean;
}

function log(message: string): void {
  console.log(`[demo-seed] ${message}`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  applyRuntimeTimezone(config);

  if (config.environment === 'production') {
    throw new Error(
      'refusing to run with NODE_ENV=production: the demo credentials are public',
    );
  }

  // The seed shares the API environment, including the validated auth config:
  // the identity module is composed exactly as the process composes it.
  const authConfig = loadAuthConfig();
  const dataSource = createDataSource(
    config.databaseUrl === undefined ? {} : { url: config.databaseUrl },
  );

  try {
    await dataSource.initialize();
    log('database connection initialized');

    const { identity } = await composeApiModules(dataSource, authConfig);
    const clock = new SystemClock();

    const organization = await ensureOrganization(dataSource, identity);
    log(
      organization.created
        ? `organization created: ${organization.id} ("${DEMO_ORGANIZATION_NAME}")`
        : `organization already present: ${organization.id} ("${DEMO_ORGANIZATION_NAME}")`,
    );

    const admin = await ensureAdminUser(identity, organization.id, clock);
    const seeded: SeededUser[] = [{ seed: DEMO_ADMIN, created: admin.created }];

    for (const seed of [DEMO_DISPATCHER, DEMO_DRIVER]) {
      seeded.push(
        await ensureInvitedUser(identity, organization.id, seed, admin.id),
      );
    }

    for (const entry of seeded) {
      log(
        `${entry.seed.email} (${entry.seed.role}) ${
          entry.created ? 'created' : 'already present, left unchanged'
        }`,
      );
    }

    printDemoCredentials(organization.id);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
      log('database connection closed');
    }
  }
}

interface EnsuredOrganization {
  readonly id: string;
  readonly created: boolean;
}

/**
 * Finds the demo organization by name, creating it through the bootstrap use
 * case when absent.
 *
 * The port exposes no name lookup and organization names are deliberately not
 * unique, so the seed reads the table directly for this existence check (the
 * oldest match wins) and leaves every write to the use case.
 */
async function ensureOrganization(
  dataSource: DataSource,
  identity: IdentityModule,
): Promise<EnsuredOrganization> {
  const existing = await dataSource
    .getRepository(OrganizationEntity)
    .findOne({
      where: { name: DEMO_ORGANIZATION_NAME },
      order: { createdAt: 'ASC' },
    });

  if (existing !== null) {
    return { id: existing.id, created: false };
  }

  const { organization } = await identity.registerOrganization.execute({
    name: DEMO_ORGANIZATION_NAME,
  });

  return { id: organization.id, created: true };
}

interface EnsuredAdmin {
  readonly id: string;
  readonly created: boolean;
}

/**
 * Bootstraps the first ADMIN user.
 *
 * `CreateUserUseCase` requires an existing ADMIN actor, so the first user is
 * written through the domain entity and the repository with the module's real
 * Argon2id hasher. Dispatchers and drivers are then created through the
 * ADMIN-only use case.
 */
async function ensureAdminUser(
  identity: IdentityModule,
  organizationId: string,
  clock: Clock,
): Promise<EnsuredAdmin> {
  const existing = await identity.users.findByEmail(
    organizationId,
    DEMO_ADMIN.email,
  );

  if (existing !== null) {
    return { id: existing.id, created: false };
  }

  const admin = User.create({
    id: new CryptoIdGenerator().nextId(),
    organizationId,
    email: DEMO_ADMIN.email,
    passwordHash: await identity.passwordHasher.hash(DEMO_ADMIN.password),
    role: DEMO_ADMIN.role,
    status: 'active',
    createdAt: clock.now(),
  });

  await identity.users.save(admin);

  return { id: admin.id, created: true };
}

/** Creates one invited user through the ADMIN-only provisioning use case. */
async function ensureInvitedUser(
  identity: IdentityModule,
  organizationId: string,
  seed: DemoUserSeed,
  actorUserId: string,
): Promise<SeededUser> {
  const existing = await identity.users.findByEmail(organizationId, seed.email);

  if (existing !== null) {
    return { seed, created: false };
  }

  await identity.createUser.execute({
    organizationId,
    actorUserId,
    email: seed.email,
    password: seed.password,
    role: seed.role,
  });

  return { seed, created: true };
}

/**
 * Prints the documented credentials exactly once, after the seed finishes.
 *
 * Existing accounts are never rewritten, so the block is explicitly not a
 * password reset: a previously seeded account keeps whatever password it has.
 */
function printDemoCredentials(organizationId: string): void {
  const rows = DEMO_USERS.map(
    (user) => `  ${user.role.padEnd(10)} ${user.email.padEnd(24)} ${user.password}`,
  ).join('\n');

  console.log(`
==============================================================================
 DEMO CREDENTIALS - DOCUMENTED DEMO ONLY, NOT FOR PRODUCTION
==============================================================================
 organizationId: ${organizationId}

${rows}

 These values are published in README.md so anyone can sign in to the demo.
 Never run this seed against a production database. Accounts that already
 existed were left untouched and keep their current password.
==============================================================================
`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[demo-seed] failed: ${message}`);
  process.exitCode = 1;
}
