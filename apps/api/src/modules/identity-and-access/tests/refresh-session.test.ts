import { describe, expect, it } from 'vitest';

import type { AuthSessionDto } from '../application/dto/AuthSessionDto.js';
import { User } from '../domain/entities/User.js';
import {
  InvalidTokenError,
  RefreshNotFoundError,
  RefreshReuseDetectedError,
} from '../domain/errors/IdentityError.js';
import {
  DISPATCHER_ID,
  NOW,
  ORGANIZATION_ID,
  buildTestModule,
  seedOrganization,
  seedUser,
} from './support/fixtures.js';
import type { IdentityTestContext } from './support/fixtures.js';

const PASSWORD = 'correct-horse-1';

async function login(context: IdentityTestContext): Promise<AuthSessionDto> {
  return context.module.login.execute({
    organizationId: ORGANIZATION_ID,
    email: 'dispatcher@lima.test',
    password: PASSWORD,
  });
}

async function seedDispatcher(context: IdentityTestContext): Promise<void> {
  await seedOrganization(context);
  await seedUser(context, {
    id: DISPATCHER_ID,
    email: 'dispatcher@lima.test',
    role: 'DISPATCHER',
    password: PASSWORD,
  });
}

describe('RefreshSession', () => {
  it('rotates the refresh token and keeps the family, revoking the presented token', async () => {
    const context = buildTestModule();
    await seedDispatcher(context);

    const first = await login(context);
    context.clock.advanceSeconds(60);

    const second = await context.module.refreshSession.execute({
      refreshToken: first.refreshToken,
    });

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(second.accessTokenExpiresAt).toBe('2026-10-27T15:16:00.000Z');
    expect(second.refreshTokenExpiresAt).toBe('2026-11-03T15:01:00.000Z');

    const oldRecord = await context.module.refreshTokens.findByHash(
      context.tokens.hashRefresh(first.refreshToken),
    );
    const newRecord = await context.module.refreshTokens.findByHash(
      context.tokens.hashRefresh(second.refreshToken),
    );

    expect(oldRecord?.revokedAt).toBe('2026-10-27T15:01:00.000Z');
    expect(newRecord).toMatchObject({
      userId: DISPATCHER_ID,
      organizationId: ORGANIZATION_ID,
      familyId: oldRecord?.familyId,
      revokedAt: null,
    });
    expect(newRecord?.familyId).not.toBe(newRecord?.id);
    expect(context.tokens.issuedAccess.at(-1)).toMatchObject({
      userId: DISPATCHER_ID,
      organizationId: ORGANIZATION_ID,
      role: 'DISPATCHER',
    });
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const context = buildTestModule();
    await seedDispatcher(context);

    const first = await login(context);
    const second = await context.module.refreshSession.execute({
      refreshToken: first.refreshToken,
    });

    await expect(
      context.module.refreshSession.execute({ refreshToken: first.refreshToken }),
    ).rejects.toBeInstanceOf(RefreshReuseDetectedError);

    const family = (
      await context.module.refreshTokens.findByHash(
        context.tokens.hashRefresh(second.refreshToken),
      )
    )?.familyId;
    expect(family).toBeDefined();

    const currentRecord = await context.module.refreshTokens.findByHash(
      context.tokens.hashRefresh(second.refreshToken),
    );
    expect(currentRecord?.revokedAt).toBe(NOW);

    // The current token was revoked by family revocation, so replaying it is
    // also treated as reuse instead of issuing a new session.
    await expect(
      context.module.refreshSession.execute({ refreshToken: second.refreshToken }),
    ).rejects.toBeInstanceOf(RefreshReuseDetectedError);
    await expect(context.module.refreshTokens.findByHash('hash:refresh-3')).resolves.toBeNull();
  });

  it('reports an unknown refresh token as not found without touching other sessions', async () => {
    const context = buildTestModule();
    await seedDispatcher(context);

    await expect(
      context.module.refreshSession.execute({ refreshToken: 'never-issued' }),
    ).rejects.toBeInstanceOf(RefreshNotFoundError);
  });

  it('rejects an expired refresh token without rotating it', async () => {
    const context = buildTestModule();
    await seedDispatcher(context);

    const session = await login(context);
    context.clock.advanceSeconds(7 * 24 * 60 * 60);

    const error: unknown = await context.module.refreshSession
      .execute({ refreshToken: session.refreshToken })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(InvalidTokenError);
    if (!(error instanceof InvalidTokenError)) {
      throw new Error('expected InvalidTokenError');
    }
    expect(error.details?.['reason']).toBe('expired');

    const record = await context.module.refreshTokens.findByHash(
      context.tokens.hashRefresh(session.refreshToken),
    );
    expect(record?.revokedAt).toBeNull();
    await expect(context.module.refreshTokens.findByHash('hash:refresh-2')).resolves.toBeNull();
  });

  it('revokes only the compromised family, leaving other devices signed in', async () => {
    const context = buildTestModule();
    await seedDispatcher(context);

    const first = await login(context);
    const second = await login(context);
    const rotated = await context.module.refreshSession.execute({
      refreshToken: first.refreshToken,
    });
    expect(rotated.refreshToken).not.toBe(first.refreshToken);

    await expect(
      context.module.refreshSession.execute({ refreshToken: first.refreshToken }),
    ).rejects.toBeInstanceOf(RefreshReuseDetectedError);

    await expect(
      context.module.refreshSession.execute({ refreshToken: second.refreshToken }),
    ).resolves.toMatchObject({ user: { id: DISPATCHER_ID } });
  });

  it('reloads the current role from storage instead of trusting the old session', async () => {
    const context = buildTestModule();
    await seedDispatcher(context);
    const session = await login(context);

    const promoted = User.create({
      id: DISPATCHER_ID,
      organizationId: ORGANIZATION_ID,
      email: 'dispatcher@lima.test',
      passwordHash: (await context.module.users.findById(DISPATCHER_ID))?.passwordHash ?? '',
      role: 'ADMIN',
      status: 'active',
      createdAt: NOW,
    });
    await context.module.users.save(promoted);

    await context.module.refreshSession.execute({ refreshToken: session.refreshToken });

    expect(context.tokens.issuedAccess.at(-1)?.role).toBe('ADMIN');
  });
});
