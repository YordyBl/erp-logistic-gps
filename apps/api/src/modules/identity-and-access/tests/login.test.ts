import { describe, expect, it } from 'vitest';

import { InvalidCredentialsError } from '../domain/errors/IdentityError.js';
import {
  DISPATCHER_ID,
  NOW,
  ORGANIZATION_ID,
  buildTestModule,
  seedOrganization,
  seedUser,
} from './support/fixtures.js';

const PASSWORD = 'correct-horse-1';

describe('Login', () => {
  it('issues a 15-minute access token and a 7-day rotating refresh token', async () => {
    const context = buildTestModule();
    await seedOrganization(context);
    await seedUser(context, { email: 'admin@lima.test', password: PASSWORD });

    const result = await context.module.login.execute({
      organizationId: ORGANIZATION_ID,
      email: '  Admin@Lima.test ',
      password: PASSWORD,
    });

    expect(result.user).toEqual({
      id: '22222222-2222-4222-8222-222222222221',
      organizationId: ORGANIZATION_ID,
      email: 'admin@lima.test',
      role: 'ADMIN',
    });
    expect(result.accessToken).toMatch(/^access\./);
    expect(result.accessTokenExpiresAt).toBe('2026-10-27T15:15:00.000Z');
    expect(result.refreshToken).toMatch(/^refresh-/);
    expect(result.refreshTokenExpiresAt).toBe('2026-11-03T15:00:00.000Z');
    expect(JSON.stringify(result)).not.toContain(PASSWORD);

    const issued = context.tokens.issuedAccess[0];
    expect(issued).toMatchObject({
      userId: '22222222-2222-4222-8222-222222222221',
      organizationId: ORGANIZATION_ID,
      role: 'ADMIN',
      exp: Math.floor(Date.parse(NOW) / 1000) + 900,
    });
    expect(issued?.jti).toMatch(/^[0-9a-f-]{36}$/);

    await expect(
      context.module.refreshTokens.findByHash(context.tokens.hashRefresh(result.refreshToken)),
    ).resolves.toMatchObject({
      userId: '22222222-2222-4222-8222-222222222221',
      organizationId: ORGANIZATION_ID,
      revokedAt: null,
      expiresAt: '2026-11-03T15:00:00.000Z',
    });
  });

  it('answers wrong password and unknown email with the same generic error and no session', async () => {
    const context = buildTestModule();
    await seedOrganization(context);
    await seedUser(context, { email: 'admin@lima.test', password: PASSWORD });

    const wrongPassword = await context.module.login
      .execute({
        organizationId: ORGANIZATION_ID,
        email: 'admin@lima.test',
        password: 'wrong-password-1',
      })
      .catch((cause: unknown) => cause);
    const unknownEmail = await context.module.login
      .execute({
        organizationId: ORGANIZATION_ID,
        email: 'nobody@lima.test',
        password: PASSWORD,
      })
      .catch((cause: unknown) => cause);

    expect(wrongPassword).toBeInstanceOf(InvalidCredentialsError);
    expect(unknownEmail).toBeInstanceOf(InvalidCredentialsError);
    if (
      !(wrongPassword instanceof InvalidCredentialsError) ||
      !(unknownEmail instanceof InvalidCredentialsError)
    ) {
      throw new Error('expected InvalidCredentialsError');
    }
    expect(wrongPassword.message).toBe(unknownEmail.message);
    expect(wrongPassword.message).toBe('Invalid email or password');
    expect(context.tokens.issuedAccess).toHaveLength(0);
    await expect(context.module.refreshTokens.findByHash('hash:refresh-1')).resolves.toBeNull();
  });

  it('scopes the lookup by organization and never crosses tenants', async () => {
    const context = buildTestModule();
    await seedOrganization(context);
    await seedUser(context, {
      id: DISPATCHER_ID,
      email: 'dispatcher@lima.test',
      role: 'DISPATCHER',
      password: PASSWORD,
    });

    await expect(
      context.module.login.execute({
        organizationId: '11111111-1111-4111-8111-111111111112',
        email: 'dispatcher@lima.test',
        password: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects a disabled user with the generic credentials error', async () => {
    const context = buildTestModule();
    await seedOrganization(context);
    await seedUser(context, {
      email: 'admin@lima.test',
      password: PASSWORD,
      status: 'disabled',
    });

    await expect(
      context.module.login.execute({
        organizationId: ORGANIZATION_ID,
        email: 'admin@lima.test',
        password: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });
});
