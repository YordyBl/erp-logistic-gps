import { describe, expect, it } from 'vitest';

import { loadAuthConfig } from '../../../config/config.js';

const SECRET = 'a'.repeat(32);

describe('loadAuthConfig', () => {
  it('reads the JWT, cookie and rate-limit configuration with ratified defaults', () => {
    expect(loadAuthConfig({ JWT_SECRET: SECRET })).toEqual({
      jwtSecret: SECRET,
      jwtIssuer: 'erp-logistic-api',
      jwtAudience: 'erp-logistic-web',
      accessTokenTtlMinutes: 15,
      refreshTokenTtlDays: 7,
      cookieSecure: true,
      loginRateLimit: {
        maxAttempts: 10,
        windowSeconds: 900,
      },
    });
  });

  it('requires a secret of at least 32 characters and provides no default', () => {
    expect(() => loadAuthConfig({})).toThrow('JWT_SECRET must be set');
    expect(() => loadAuthConfig({ JWT_SECRET: '   ' })).toThrow('JWT_SECRET must be set');
    expect(() => loadAuthConfig({ JWT_SECRET: 'a'.repeat(31) })).toThrow(
      'JWT_SECRET must be at least 32 characters',
    );
  });

  it('reads overrides and treats blank issuer/audience as absent', () => {
    expect(
      loadAuthConfig({
        JWT_SECRET: SECRET,
        JWT_ISSUER: ' lima-api ',
        JWT_AUDIENCE: 'lima-web',
        ACCESS_TOKEN_TTL_MINUTES: '30',
        REFRESH_TOKEN_TTL_DAYS: '14',
        LOGIN_RATE_LIMIT_MAX_ATTEMPTS: '5',
        LOGIN_RATE_LIMIT_WINDOW_SECONDS: '60',
      }),
    ).toMatchObject({
      jwtIssuer: 'lima-api',
      jwtAudience: 'lima-web',
      accessTokenTtlMinutes: 30,
      refreshTokenTtlDays: 14,
      loginRateLimit: { maxAttempts: 5, windowSeconds: 60 },
    });
    expect(loadAuthConfig({ JWT_SECRET: SECRET, JWT_ISSUER: '  ' }).jwtIssuer).toBe(
      'erp-logistic-api',
    );
  });

  it('parses COOKIE_SECURE and rejects ambiguous values', () => {
    expect(loadAuthConfig({ JWT_SECRET: SECRET, COOKIE_SECURE: 'false' }).cookieSecure).toBe(
      false,
    );
    expect(loadAuthConfig({ JWT_SECRET: SECRET, COOKIE_SECURE: 'TRUE' }).cookieSecure).toBe(
      true,
    );
    expect(() => loadAuthConfig({ JWT_SECRET: SECRET, COOKIE_SECURE: 'yes' })).toThrow(
      'COOKIE_SECURE must be "true" or "false"',
    );
  });

  it('rejects non-positive or non-integer lifetimes and limits', () => {
    expect(() =>
      loadAuthConfig({ JWT_SECRET: SECRET, ACCESS_TOKEN_TTL_MINUTES: '0' }),
    ).toThrow('ACCESS_TOKEN_TTL_MINUTES must be a positive integer');
    expect(() =>
      loadAuthConfig({ JWT_SECRET: SECRET, REFRESH_TOKEN_TTL_DAYS: '7.5' }),
    ).toThrow('REFRESH_TOKEN_TTL_DAYS must be a positive integer');
    expect(() =>
      loadAuthConfig({ JWT_SECRET: SECRET, LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 'many' }),
    ).toThrow('LOGIN_RATE_LIMIT_MAX_ATTEMPTS must be a positive integer');
    expect(() =>
      loadAuthConfig({ JWT_SECRET: SECRET, LOGIN_RATE_LIMIT_WINDOW_SECONDS: '-1' }),
    ).toThrow('LOGIN_RATE_LIMIT_WINDOW_SECONDS must be a positive integer');
  });
});
