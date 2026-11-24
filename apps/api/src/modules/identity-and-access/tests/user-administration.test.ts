import { describe, expect, it } from 'vitest';

import { displayName, User } from '../domain/entities/User.js';
import {
  DriverAccountLinkedError,
  ForbiddenRoleError,
  IdentityValidationError,
  SelfChangeForbiddenError,
  UserNotFoundError,
  WeakPasswordError,
} from '../domain/errors/IdentityError.js';
import {
  ADMIN_ID,
  DISPATCHER_ID,
  DRIVER_ID,
  NOW,
  ORGANIZATION_ID,
  OTHER_ORGANIZATION_ID,
  buildTestModule,
  seedAdminContext,
  seedOrganization,
  seedUser,
  type IdentityTestContext,
} from './support/fixtures.js';

const SECOND_ADMIN_ID = '22222222-2222-4222-8222-222222222224';

async function seedTeam(linkedDriverUserIds: readonly string[] = []): Promise<IdentityTestContext> {
  const context = buildTestModule();
  await seedAdminContext(context);
  await seedUser(context, { id: DISPATCHER_ID, email: 'dispatcher@lima.test', role: 'DISPATCHER' });
  await seedUser(context, { id: DRIVER_ID, email: 'driver@lima.test', role: 'DRIVER' });
  context.module.setDriverAccountLookup({
    isLinkedToDriver: async (_organizationId, userId) => linkedDriverUserIds.includes(userId),
  });
  return context;
}

function update(userId: string, changes: Record<string, unknown>, actorUserId = ADMIN_ID) {
  return { organizationId: ORGANIZATION_ID, actorUserId, userId, changes };
}

describe('User entity names', () => {
  it('trims the name parts, keeps apellido materno optional and composes the display name', () => {
    const user = User.create({
      id: DRIVER_ID, organizationId: ORGANIZATION_ID, email: 'driver@lima.test',
      passwordHash: 'hashed:x', role: 'DRIVER', status: 'active', createdAt: NOW,
      name: { firstName: '  Jorge   Luis ', paternalSurname: 'Huamán ', maternalSurname: '  ' },
    });

    expect(user.name).toEqual({ firstName: 'Jorge Luis', paternalSurname: 'Huamán', maternalSurname: null });
    expect(displayName(user.name)).toBe('Jorge Luis Huamán');
    expect(displayName(null)).toBeNull();
  });

  it('rejects a name without apellido paterno', () => {
    expect(() => User.create({
      id: DRIVER_ID, organizationId: ORGANIZATION_ID, email: 'driver@lima.test',
      passwordHash: 'hashed:x', role: 'DRIVER', status: 'active', createdAt: NOW,
      name: { firstName: 'Jorge', paternalSurname: ' ', maternalSurname: null },
    })).toThrow(IdentityValidationError);
  });
});

describe('ListUsers', () => {
  it('lists every account of the ADMIN organization only', async () => {
    const context = await seedTeam();
    await seedOrganization(context, { id: OTHER_ORGANIZATION_ID });
    await seedUser(context, { id: SECOND_ADMIN_ID, organizationId: OTHER_ORGANIZATION_ID, email: 'admin@callao.test' });

    const result = await context.module.listUsers.execute({ organizationId: ORGANIZATION_ID, actorUserId: ADMIN_ID });

    expect(result.users.map((user) => user.email)).toEqual(['admin@lima.test', 'dispatcher@lima.test', 'driver@lima.test']);
    expect(result.users[0]).toMatchObject({ firstName: null, paternalSurname: null, lastLoginAt: null });
    expect(JSON.stringify(result)).not.toContain('hashed:');
  });

  it('rejects a DISPATCHER actor', async () => {
    const context = await seedTeam();

    await expect(context.module.listUsers.execute({ organizationId: ORGANIZATION_ID, actorUserId: DISPATCHER_ID }))
      .rejects.toBeInstanceOf(ForbiddenRoleError);
  });
});

describe('UpdateUser', () => {
  it('changes the name, role and status of another account', async () => {
    const context = await seedTeam();

    const result = await context.module.updateUser.execute(update(DISPATCHER_ID, {
      firstName: 'Carla', paternalSurname: 'Benites', maternalSurname: 'Rojas', role: 'ADMIN',
    }));

    expect(result.user).toMatchObject({
      firstName: 'Carla', paternalSurname: 'Benites', maternalSurname: 'Rojas', role: 'ADMIN', status: 'active',
    });
    expect((await context.module.users.findById(DISPATCHER_ID))?.role).toBe('ADMIN');
  });

  it('requires nombres and apellido paterno together', async () => {
    const context = await seedTeam();

    await expect(context.module.updateUser.execute(update(DISPATCHER_ID, { firstName: 'Carla' })))
      .rejects.toBeInstanceOf(IdentityValidationError);
    await expect(context.module.updateUser.execute(update(DISPATCHER_ID, {})))
      .rejects.toBeInstanceOf(IdentityValidationError);
  });

  it('forbids an ADMIN from changing their own role or disabling themselves', async () => {
    const context = await seedTeam();
    await seedUser(context, { id: SECOND_ADMIN_ID, email: 'admin2@lima.test' });

    await expect(context.module.updateUser.execute(update(ADMIN_ID, { role: 'DISPATCHER' })))
      .rejects.toBeInstanceOf(SelfChangeForbiddenError);
    await expect(context.module.updateUser.execute(update(ADMIN_ID, { status: 'disabled' })))
      .rejects.toBeInstanceOf(SelfChangeForbiddenError);

    const renamed = await context.module.updateUser.execute(update(ADMIN_ID, { firstName: 'Ana', paternalSurname: 'Paz' }));
    expect(renamed.user.firstName).toBe('Ana');
  });

  it('always keeps the acting ADMIN, so the organization never runs out of administrators', async () => {
    const context = await seedTeam();
    await seedUser(context, { id: SECOND_ADMIN_ID, email: 'admin2@lima.test' });

    await context.module.updateUser.execute(update(ADMIN_ID, { status: 'disabled' }, SECOND_ADMIN_ID));

    // The disabled ADMIN can no longer act, and the remaining one cannot demote itself.
    await expect(context.module.updateUser.execute(update(SECOND_ADMIN_ID, { status: 'active' }, ADMIN_ID)))
      .rejects.toBeInstanceOf(UserNotFoundError);
    await expect(context.module.updateUser.execute(update(SECOND_ADMIN_ID, { role: 'DISPATCHER' }, SECOND_ADMIN_ID)))
      .rejects.toBeInstanceOf(SelfChangeForbiddenError);

    const reactivated = await context.module.updateUser.execute(update(ADMIN_ID, { status: 'active' }, SECOND_ADMIN_ID));
    expect(reactivated.user.status).toBe('active');
  });

  it('refuses to change the role of a DRIVER account linked to a driver', async () => {
    const context = await seedTeam([DRIVER_ID]);

    await expect(context.module.updateUser.execute(update(DRIVER_ID, { role: 'DISPATCHER' })))
      .rejects.toBeInstanceOf(DriverAccountLinkedError);

    const disabled = await context.module.updateUser.execute(update(DRIVER_ID, { status: 'disabled' }));
    expect(disabled.user.status).toBe('disabled');
  });

  it('ends every session of a disabled account', async () => {
    const context = await seedTeam();
    await context.module.refreshTokens.save({
      id: '99999999-9999-4999-8999-999999999991', userId: DISPATCHER_ID, organizationId: ORGANIZATION_ID,
      familyId: '99999999-9999-4999-8999-999999999992', tokenHash: 'a'.repeat(64),
      issuedAt: NOW, expiresAt: '2026-11-27T15:00:00.000Z', revokedAt: null,
    });

    await context.module.updateUser.execute(update(DISPATCHER_ID, { status: 'disabled' }));

    expect((await context.module.refreshTokens.findByHash('a'.repeat(64)))?.revokedAt).toBe(NOW);
  });

  it('answers another tenant user as not found', async () => {
    const context = await seedTeam();
    await seedOrganization(context, { id: OTHER_ORGANIZATION_ID });
    await seedUser(context, { id: SECOND_ADMIN_ID, organizationId: OTHER_ORGANIZATION_ID, email: 'admin@callao.test' });

    await expect(context.module.updateUser.execute(update(SECOND_ADMIN_ID, { status: 'disabled' })))
      .rejects.toBeInstanceOf(UserNotFoundError);
  });
});

describe('ResetUserPassword', () => {
  it('stores the new temporary password hashed and ends the sessions', async () => {
    const context = await seedTeam();
    await context.module.refreshTokens.save({
      id: '99999999-9999-4999-8999-999999999991', userId: DRIVER_ID, organizationId: ORGANIZATION_ID,
      familyId: '99999999-9999-4999-8999-999999999992', tokenHash: 'b'.repeat(64),
      issuedAt: NOW, expiresAt: '2026-11-27T15:00:00.000Z', revokedAt: null,
    });

    await context.module.resetUserPassword.execute({
      organizationId: ORGANIZATION_ID, actorUserId: ADMIN_ID, userId: DRIVER_ID, password: 'nueva-clave-2026',
    });

    expect((await context.module.users.findById(DRIVER_ID))?.passwordHash).toBe('hashed:nueva-clave-2026');
    expect((await context.module.refreshTokens.findByHash('b'.repeat(64)))?.revokedAt).toBe(NOW);
  });

  it('applies the password policy and the ADMIN check', async () => {
    const context = await seedTeam();

    await expect(context.module.resetUserPassword.execute({
      organizationId: ORGANIZATION_ID, actorUserId: ADMIN_ID, userId: DRIVER_ID, password: 'corta',
    })).rejects.toBeInstanceOf(WeakPasswordError);
    await expect(context.module.resetUserPassword.execute({
      organizationId: ORGANIZATION_ID, actorUserId: DISPATCHER_ID, userId: DRIVER_ID, password: 'nueva-clave-2026',
    })).rejects.toBeInstanceOf(ForbiddenRoleError);
  });
});

describe('Login records the last sign-in', () => {
  it('sets lastLoginAt on a successful login only', async () => {
    const context = await seedTeam();

    await expect(context.module.login.execute({
      organizationId: ORGANIZATION_ID, email: 'driver@lima.test', password: 'wrong-password-1',
    })).rejects.toThrow();
    expect((await context.module.users.findById(DRIVER_ID))?.lastLoginAt).toBeNull();

    await context.module.login.execute({
      organizationId: ORGANIZATION_ID, email: 'driver@lima.test', password: 'correct-horse-1',
    });
    expect((await context.module.users.findById(DRIVER_ID))?.lastLoginAt).toBe(NOW);
  });
});
