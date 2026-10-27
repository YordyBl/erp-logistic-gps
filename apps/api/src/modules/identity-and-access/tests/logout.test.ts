import { describe, expect, it } from 'vitest';

import { IdentityValidationError } from '../domain/errors/IdentityError.js';
import {
  NOW,
  ORGANIZATION_ID,
  buildTestModule,
  seedOrganization,
  seedUser,
} from './support/fixtures.js';
import type { IdentityTestContext } from './support/fixtures.js';

const PASSWORD = 'correct-horse-1';

async function login(context: IdentityTestContext): Promise<string> {
  const session = await context.module.login.execute({
    organizationId: ORGANIZATION_ID,
    email: 'admin@lima.test',
    password: PASSWORD,
  });
  return session.refreshToken;
}

async function seedAdmin(context: IdentityTestContext): Promise<void> {
  await seedOrganization(context);
  await seedUser(context, { email: 'admin@lima.test', password: PASSWORD });
}

describe('Logout', () => {
  it('revokes the presented refresh token', async () => {
    const context = buildTestModule();
    await seedAdmin(context);
    const refreshToken = await login(context);

    await expect(context.module.logout.execute({ refreshToken })).resolves.toEqual({
      revoked: true,
    });

    await expect(
      context.module.refreshTokens.findByHash(context.tokens.hashRefresh(refreshToken)),
    ).resolves.toMatchObject({ revokedAt: NOW });
  });

  it('is idempotent for an already revoked or unknown token', async () => {
    const context = buildTestModule();
    await seedAdmin(context);
    const refreshToken = await login(context);

    await context.module.logout.execute({ refreshToken });

    await expect(context.module.logout.execute({ refreshToken })).resolves.toEqual({
      revoked: false,
    });
    await expect(
      context.module.logout.execute({ refreshToken: 'never-issued' }),
    ).resolves.toEqual({ revoked: false });
  });

  it('does not revoke other device sessions', async () => {
    const context = buildTestModule();
    await seedAdmin(context);
    const first = await login(context);
    const second = await login(context);

    await context.module.logout.execute({ refreshToken: first });

    await expect(
      context.module.refreshSession.execute({ refreshToken: second }),
    ).resolves.toMatchObject({ user: { id: '22222222-2222-4222-8222-222222222221' } });
  });

  it('rejects a malformed command instead of silently accepting it', async () => {
    const context = buildTestModule();

    await expect(context.module.logout.execute({ refreshToken: '' })).rejects.toBeInstanceOf(
      IdentityValidationError,
    );
  });
});
