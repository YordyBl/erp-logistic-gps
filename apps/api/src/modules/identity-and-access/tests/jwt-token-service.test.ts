import { randomBytes } from 'node:crypto';

import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { InvalidTokenError } from '../domain/errors/IdentityError.js';
import {
  JwtTokenService,
  type JwtTokenServiceOptions,
} from '../infrastructure/security/jwt-token-service.js';

const SECRET = randomBytes(32).toString('hex');
const USER_ID = '22222222-2222-4222-8222-222222222221';
const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const NOW_SECONDS = Math.floor(Date.now() / 1000);

function buildService(overrides: Partial<JwtTokenServiceOptions> = {}): JwtTokenService {
  return new JwtTokenService({
    secret: SECRET,
    issuer: 'erp-logistic-api',
    audience: 'erp-logistic-web',
    ...overrides,
  });
}

function accessInput(exp = NOW_SECONDS + 60) {
  return {
    userId: USER_ID,
    organizationId: ORGANIZATION_ID,
    role: 'ADMIN' as const,
    jti: '44444444-4444-4444-8444-444444444444',
    exp,
  };
}

async function foreignToken(
  options: {
    secret?: string;
    alg?: string;
    audience?: string;
    jti?: string | null;
    exp?: number;
    nbf?: number;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = new SignJWT({ organizationId: ORGANIZATION_ID, role: 'ADMIN' })
    .setProtectedHeader({ alg: options.alg ?? 'HS256' })
    .setIssuer('erp-logistic-api')
    .setAudience(options.audience ?? 'erp-logistic-web')
    .setSubject(USER_ID)
    .setIssuedAt(now)
    .setNotBefore(options.nbf ?? now)
    .setExpirationTime(options.exp ?? now + 60);

  if (options.jti !== null) {
    token.setJti(options.jti ?? '55555555-5555-4555-8555-555555555555');
  }

  return token.sign(new TextEncoder().encode(options.secret ?? SECRET));
}

describe('JwtTokenService', () => {
  it('issues an HS256 access token with the ratified claims and verifies it', async () => {
    const service = buildService();

    const token = await service.issueAccess(accessInput());
    const verified = await service.verifyAccess(token);

    expect(token.split('.')).toHaveLength(3);
    expect(verified).toEqual({
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      role: 'ADMIN',
      jti: '44444444-4444-4444-8444-444444444444',
      expiresAt: new Date((NOW_SECONDS + 60) * 1000).toISOString(),
      issuedAt: expect.any(String) as string,
    });
  });

  it('rejects a token signed with another secret', async () => {
    const token = await foreignToken({ secret: randomBytes(32).toString('hex') });

    await expect(buildService().verifyAccess(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('rejects a token for another audience or issuer', async () => {
    await expect(
      buildService().verifyAccess(await foreignToken({ audience: 'another-app' })),
    ).rejects.toBeInstanceOf(InvalidTokenError);
    await expect(
      buildService({ issuer: 'another-api' }).verifyAccess(await foreignToken()),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('pins the algorithm instead of trusting the token header', async () => {
    await expect(
      buildService().verifyAccess(await foreignToken({ alg: 'HS512' })),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('requires iss, aud, exp, nbf, sub and jti', async () => {
    await expect(
      buildService().verifyAccess(await foreignToken({ jti: null })),
    ).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('rejects an expired token and reports the reason without echoing the token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await foreignToken({ exp: now - 60, nbf: now - 120 });

    const error: unknown = await buildService({ clockToleranceSeconds: 0 })
      .verifyAccess(token)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(InvalidTokenError);
    if (!(error instanceof InvalidTokenError)) {
      throw new Error('expected InvalidTokenError');
    }
    expect(error.details?.['reason']).toBe('expired');
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain(
      token,
    );
  });

  it('rejects a malformed token as a typed error', async () => {
    await expect(buildService().verifyAccess('not-a-jwt')).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  });

  it('generates a 256-bit refresh token and its stable SHA-256 hash', () => {
    const service = buildService();

    const first = service.generateRefresh();
    const second = service.generateRefresh();

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(service.hashRefresh(first.token)).toBe(first.hash);
    expect(first.token).not.toBe(second.token);
    expect(first.hash).not.toBe(second.hash);
  });

  it('refuses to construct with a secret shorter than 32 characters', () => {
    expect(() => buildService({ secret: 'short' })).toThrow(
      'JWT secret must be at least 32 characters',
    );
  });
});
