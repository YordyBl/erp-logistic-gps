import { describe, expect, it } from 'vitest';

import {
  EmailAlreadyInUseError,
  ForbiddenRoleError,
  IdentityValidationError,
  OrganizationNotFoundError,
  UserNotFoundError,
  WeakPasswordError,
} from '../domain/errors/IdentityError.js';
import {
  ADMIN_ID,
  DISPATCHER_ID,
  ORGANIZATION_ID,
  OTHER_ORGANIZATION_ID,
  buildTestModule,
  seedAdminContext,
  seedOrganization,
  seedUser,
} from './support/fixtures.js';

const NEW_USER_ID = '00000000-0000-4000-8000-000000000001';

function createCommand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organizationId: ORGANIZATION_ID,
    actorUserId: ADMIN_ID,
    email: 'ana.torres@lima.test',
    password: 'delivery2026',
    role: 'DISPATCHER',
    ...overrides,
  };
}

describe('CreateUser', () => {
  it('lets an ADMIN create a user in their own organization with a hashed password', async () => {
    const context = buildTestModule();
    await seedAdminContext(context);

    const result = await context.module.createUser.execute(
      createCommand({ email: '  Ana.Torres@Lima.test  ' }),
    );

    expect(result.user).toEqual({
      id: NEW_USER_ID,
      organizationId: ORGANIZATION_ID,
      email: 'ana.torres@lima.test',
      role: 'DISPATCHER',
      status: 'active',
      createdAt: expect.any(String) as string,
    });

    const stored = await context.module.users.findById(NEW_USER_ID);
    expect(stored?.passwordHash).toBe('hashed:delivery2026');
    expect(JSON.stringify(result)).not.toContain('delivery2026');
  });

  it('rejects a non-ADMIN actor and stores nothing', async () => {
    const context = buildTestModule();
    await seedOrganization(context);
    await seedUser(context, {
      id: DISPATCHER_ID,
      email: 'dispatcher@lima.test',
      role: 'DISPATCHER',
    });

    const error: unknown = await context.module.createUser
      .execute(createCommand({ actorUserId: DISPATCHER_ID }))
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ForbiddenRoleError);
    if (!(error instanceof ForbiddenRoleError)) {
      throw new Error('expected ForbiddenRoleError');
    }
    expect(error.requiredRole).toBe('ADMIN');
    expect(error.actualRole).toBe('DISPATCHER');
    await expect(context.module.users.findById(NEW_USER_ID)).resolves.toBeNull();
  });

  it('rejects an ADMIN from another organization as an unknown actor', async () => {
    const context = buildTestModule();
    await seedOrganization(context);
    await seedOrganization(context, {
      id: OTHER_ORGANIZATION_ID,
      name: 'Callao Cargo',
    });
    await seedUser(context);
    await seedUser(context, {
      id: '22222222-2222-4222-8222-222222222229',
      organizationId: OTHER_ORGANIZATION_ID,
      email: 'admin@callao.test',
    });

    await expect(
      context.module.createUser.execute(
        createCommand({ actorUserId: '22222222-2222-4222-8222-222222222229' }),
      ),
    ).rejects.toBeInstanceOf(UserNotFoundError);
    await expect(context.module.users.findById(NEW_USER_ID)).resolves.toBeNull();
  });

  it('rejects an unknown organization for an authenticated ADMIN', async () => {
    const context = buildTestModule();
    await seedUser(context, {
      organizationId: '33333333-3333-4333-8333-333333333333',
    });

    await expect(
      context.module.createUser.execute(
        createCommand({ organizationId: '33333333-3333-4333-8333-333333333333' }),
      ),
    ).rejects.toBeInstanceOf(OrganizationNotFoundError);
  });

  it('rejects a duplicate email inside the same organization, case-insensitively', async () => {
    const context = buildTestModule();
    await seedAdminContext(context);
    await seedUser(context, {
      id: DISPATCHER_ID,
      email: 'ana.torres@lima.test',
      role: 'DISPATCHER',
    });

    await expect(
      context.module.createUser.execute(
        createCommand({ email: 'ANA.TORRES@LIMA.TEST', role: 'DRIVER' }),
      ),
    ).rejects.toBeInstanceOf(EmailAlreadyInUseError);
    await expect(context.module.users.findById(NEW_USER_ID)).resolves.toBeNull();
  });

  it('allows the same email address in a different organization', async () => {
    const context = buildTestModule();
    await seedAdminContext(context);
    await seedOrganization(context, {
      id: OTHER_ORGANIZATION_ID,
      name: 'Callao Cargo',
    });
    await seedUser(context, {
      id: DISPATCHER_ID,
      organizationId: OTHER_ORGANIZATION_ID,
      email: 'ana.torres@lima.test',
    });

    const result = await context.module.createUser.execute(createCommand());

    expect(result.user.organizationId).toBe(ORGANIZATION_ID);
  });

  it('rejects a password that does not meet the policy and does not store a user', async () => {
    const context = buildTestModule();
    await seedAdminContext(context);

    const error: unknown = await context.module.createUser
      .execute(createCommand({ password: 'short1' }))
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(WeakPasswordError);
    if (!(error instanceof WeakPasswordError)) {
      throw new Error('expected WeakPasswordError');
    }
    expect(error.details?.['reasons']).toEqual(['minimum_length']);
    await expect(context.module.users.findById(NEW_USER_ID)).resolves.toBeNull();
  });

  it('rejects an invalid role, email and identifier at the application boundary', async () => {
    const context = buildTestModule();
    await seedAdminContext(context);

    const error: unknown = await context.module.createUser
      .execute(createCommand({ role: 'OWNER' }))
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(IdentityValidationError);
    if (!(error instanceof IdentityValidationError)) {
      throw new Error('expected IdentityValidationError');
    }
    expect(error.details?.['issues']).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'role' })]),
    );

    await expect(
      context.module.createUser.execute(createCommand({ email: 'not-an-email' })),
    ).rejects.toBeInstanceOf(IdentityValidationError);
    await expect(
      context.module.createUser.execute(createCommand({ actorUserId: 'actor' })),
    ).rejects.toBeInstanceOf(IdentityValidationError);
  });
});
