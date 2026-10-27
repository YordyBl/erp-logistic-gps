import { randomBytes, randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import request, { type Response as SupertestResponse } from 'supertest';
import { describe, expect, it } from 'vitest';

import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../cookies.js';
import {
  ADMIN_EMAIL,
  ADMIN_ID,
  bearer,
  buildTestApp,
  ORGANIZATION_ID,
  OTHER_ORGANIZATION_ID,
  TEST_JWT_AUDIENCE,
  TEST_JWT_ISSUER,
  TEST_JWT_SECRET,
  TEST_PASSWORD,
  type TestApp,
} from './support/test-app.js';

const LOGIN_PATH = '/api/v1/auth/login';
const REFRESH_PATH = '/api/v1/auth/refresh';
const LOGOUT_PATH = '/api/v1/auth/logout';
const ME_PATH = '/api/v1/auth/me';

function setCookieHeaders(response: SupertestResponse): string[] {
  const header: unknown = response.headers['set-cookie'];
  if (Array.isArray(header)) {
    return header as string[];
  }

  return typeof header === 'string' ? [header] : [];
}

function refreshCookie(response: SupertestResponse): string | undefined {
  return setCookieHeaders(response).find((cookie) =>
    cookie.startsWith(`${REFRESH_COOKIE_NAME}=`),
  );
}

function refreshCookieValue(response: SupertestResponse): string | undefined {
  const cookie = refreshCookie(response);
  if (cookie === undefined) {
    return undefined;
  }

  return cookie.slice(REFRESH_COOKIE_NAME.length + 1).split(';')[0];
}

function refreshCookieHeader(value: string): Record<string, string> {
  return { cookie: `${REFRESH_COOKIE_NAME}=${value}` };
}

async function seededApp(
  options: Parameters<typeof buildTestApp>[0] = {},
): Promise<TestApp> {
  const testApp = buildTestApp(options);

  await testApp.seedOrganization();
  await testApp.seedUser({
    id: ADMIN_ID,
    email: ADMIN_EMAIL,
    password: TEST_PASSWORD,
    role: 'ADMIN',
  });

  return testApp;
}

async function login(
  testApp: TestApp,
  overrides: Record<string, unknown> = {},
): Promise<SupertestResponse> {
  return request(testApp.app).post(LOGIN_PATH).send({
    organizationId: ORGANIZATION_ID,
    email: ADMIN_EMAIL,
    password: TEST_PASSWORD,
    ...overrides,
  });
}

async function loginAndRefreshCookie(testApp: TestApp): Promise<string> {
  const response = await login(testApp);
  expect(response.status).toBe(200);

  const cookie = refreshCookieValue(response);
  expect(cookie).toBeDefined();
  return cookie as string;
}

async function foreignAccessToken(
  options: {
    readonly sub?: string;
    readonly organizationId?: string;
    readonly role?: string;
    readonly jti?: string;
    readonly exp?: number;
    readonly nbf?: number;
    readonly secret?: string;
    readonly issuer?: string;
    readonly audience?: string;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    organizationId: options.organizationId ?? ORGANIZATION_ID,
    role: options.role ?? 'ADMIN',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(options.issuer ?? TEST_JWT_ISSUER)
    .setAudience(options.audience ?? TEST_JWT_AUDIENCE)
    .setSubject(options.sub ?? ADMIN_ID)
    .setJti(options.jti ?? randomUUID())
    .setIssuedAt(now)
    .setNotBefore(options.nbf ?? now)
    .setExpirationTime(options.exp ?? now + 900)
    .sign(new TextEncoder().encode(options.secret ?? TEST_JWT_SECRET));
}

describe('POST /api/v1/auth/login', () => {
  it('returns the access token in the body and the refresh token in a strict cookie', async () => {
    const testApp = await seededApp();

    const response = await login(testApp);

    expect(response.status).toBe(200);
    expect(response.body.data.user).toEqual({
      id: ADMIN_ID,
      organizationId: ORGANIZATION_ID,
      email: ADMIN_EMAIL,
      role: 'ADMIN',
    });
    expect(response.body.data.accessToken.split('.')).toHaveLength(3);
    expect(response.body.data.accessTokenExpiresAt).toEqual(expect.any(String));
    expect(response.body.data.refreshTokenExpiresAt).toEqual(expect.any(String));
    // The refresh token must never be readable by JavaScript.
    expect(response.body.data.refreshToken).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(TEST_PASSWORD);

    const cookie = refreshCookie(response);
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain(`Path=${REFRESH_COOKIE_PATH}`);
    expect(cookie).toContain('Max-Age=604800');
    // COOKIE_SECURE=false is the documented local-http development value.
    expect(cookie).not.toContain('Secure');

    const me = await request(testApp.app)
      .get(ME_PATH)
      .set(bearer(response.body.data.accessToken as string));

    expect(me.status).toBe(200);
    expect(me.body.data.id).toBe(ADMIN_ID);
  });

  it('marks the refresh cookie Secure when COOKIE_SECURE is enabled', async () => {
    const testApp = await seededApp({ cookieSecure: true });

    const response = await login(testApp);

    expect(response.status).toBe(200);
    expect(refreshCookie(response)).toContain('Secure');
  });

  it('answers a wrong password and an unknown email with the same generic 401', async () => {
    const testApp = await seededApp();

    const wrongPassword = await login(testApp, { password: 'wrong-password-1' });
    const unknownEmail = await login(testApp, { email: 'nobody@lima.test' });

    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('IDENTITY_INVALID_CREDENTIALS');
      expect(response.body.error.message).toBe('Invalid email or password');
      expect(response.body.error.details).toBeUndefined();
      expect(setCookieHeaders(response)).toEqual([]);
    }
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('rejects a disabled account with the generic 401 and no session', async () => {
    const testApp = buildTestApp();
    await testApp.seedOrganization();
    await testApp.seedUser({ id: ADMIN_ID, email: ADMIN_EMAIL, status: 'disabled' });

    const response = await login(testApp);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('IDENTITY_INVALID_CREDENTIALS');
    expect(setCookieHeaders(response)).toEqual([]);
    await expect(
      testApp.identity.refreshTokens.findByHash('anything'),
    ).resolves.toBeNull();
  });

  it('validates the body with the application schema', async () => {
    const testApp = await seededApp();

    const missingOrganization = await login(testApp, { organizationId: undefined });
    const malformedEmail = await login(testApp, { email: 'not-an-email' });

    for (const response of [missingOrganization, malformedEmail]) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('IDENTITY_INVALID_INPUT');
      expect(response.body.error.details.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('login rate limiting', () => {
  it('returns 429 after the configured number of attempts and isolates other keys', async () => {
    const testApp = await seededApp({ loginRateLimit: { maxAttempts: 2, windowSeconds: 900 } });

    const first = await login(testApp, { password: 'wrong-password-1' });
    const second = await login(testApp, { password: 'wrong-password-1' });
    const blocked = await login(testApp, { password: 'wrong-password-1' });

    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('AUTH_RATE_LIMITED');
    expect(blocked.body.error.details).toEqual({ retryAfterSeconds: 900 });
    expect(blocked.headers['retry-after']).toBe('900');

    // The limiter is keyed by IP + email, so another account is unaffected.
    const otherEmail = await login(testApp, {
      email: 'unknown@lima.test',
      password: 'wrong-password-1',
    });
    expect(otherEmail.status).toBe(401);

    // Not even the right password gets through while the window is exhausted.
    const correctPassword = await login(testApp);
    expect(correctPassword.status).toBe(429);
  });

  it('does not count a successful login against the window', async () => {
    const testApp = await seededApp({ loginRateLimit: { maxAttempts: 2, windowSeconds: 900 } });

    const success = await login(testApp);
    const secondSuccess = await login(testApp);

    expect(success.status).toBe(200);
    expect(secondSuccess.status).toBe(200);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('rotates the refresh token and returns a new access token', async () => {
    const testApp = await seededApp();
    const firstLogin = await login(testApp);
    const firstCookie = refreshCookieValue(firstLogin);

    const rotated = await request(testApp.app)
      .post(REFRESH_PATH)
      .set(refreshCookieHeader(firstCookie as string));

    expect(rotated.status).toBe(200);
    expect(rotated.body.data.accessToken).not.toBe(firstLogin.body.data.accessToken);

    const secondCookie = refreshCookieValue(rotated);
    expect(secondCookie).toBeDefined();
    expect(secondCookie).not.toBe(firstCookie);
    expect(refreshCookie(rotated)).toContain('Path=/api/v1/auth');

    // The old access token still works until it expires: stateless by design.
    const me = await request(testApp.app)
      .get(ME_PATH)
      .set(bearer(rotated.body.data.accessToken as string));
    expect(me.status).toBe(200);
  });

  it('treats a replayed refresh token as reuse, revoking the whole family', async () => {
    const testApp = await seededApp();
    const firstCookie = await loginAndRefreshCookie(testApp);

    const rotation = await request(testApp.app)
      .post(REFRESH_PATH)
      .set(refreshCookieHeader(firstCookie));
    const secondCookie = refreshCookieValue(rotation);

    const replay = await request(testApp.app)
      .post(REFRESH_PATH)
      .set(refreshCookieHeader(firstCookie));

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('IDENTITY_REFRESH_REUSE_DETECTED');
    // The compromised chain is cleared on the client too.
    expect(refreshCookie(replay)).toContain('Max-Age=0');

    // The token issued by the rotation belonged to the same family, so it dies
    // with the family: the victim must log in again.
    const afterRevocation = await request(testApp.app)
      .post(REFRESH_PATH)
      .set(refreshCookieHeader(secondCookie as string));

    expect(afterRevocation.status).toBe(401);
    expect(afterRevocation.body.error.code).toBe('IDENTITY_REFRESH_REUSE_DETECTED');
  });

  it('returns 401 when the refresh cookie is missing', async () => {
    const testApp = await seededApp();

    const response = await request(testApp.app).post(REFRESH_PATH);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REFRESH_TOKEN_MISSING');
    expect(refreshCookie(response)).toContain('Max-Age=0');
  });

  it('returns 401 for an unknown refresh token and clears the cookie', async () => {
    const testApp = await seededApp();
    const unknown = randomBytes(32).toString('base64url');

    const response = await request(testApp.app)
      .post(REFRESH_PATH)
      .set(refreshCookieHeader(unknown));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('IDENTITY_REFRESH_NOT_FOUND');
    expect(refreshCookie(response)).toContain('Max-Age=0');
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the current refresh token, clears the cookie and stays idempotent', async () => {
    const testApp = await seededApp();
    const refreshToken = await loginAndRefreshCookie(testApp);

    const logout = await request(testApp.app)
      .post(LOGOUT_PATH)
      .set(refreshCookieHeader(refreshToken));

    expect(logout.status).toBe(204);
    expect(refreshCookie(logout)).toContain('Max-Age=0');

    // The revoked token cannot be rotated anymore.
    const refreshAfterLogout = await request(testApp.app)
      .post(REFRESH_PATH)
      .set(refreshCookieHeader(refreshToken));
    expect(refreshAfterLogout.status).toBe(401);

    // A repeated logout is a successful no-op, not an error.
    const secondLogout = await request(testApp.app)
      .post(LOGOUT_PATH)
      .set(refreshCookieHeader(refreshToken));
    expect(secondLogout.status).toBe(204);

    const withoutCookie = await request(testApp.app).post(LOGOUT_PATH);
    expect(withoutCookie.status).toBe(204);
    expect(refreshCookie(withoutCookie)).toContain('Max-Age=0');
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the current user from the verified JWT', async () => {
    const testApp = await seededApp();
    const loginResponse = await request(testApp.app)
      .post(LOGIN_PATH)
      .send({
        organizationId: ORGANIZATION_ID,
        email: ADMIN_EMAIL,
        password: TEST_PASSWORD,
      });

    const response = await request(testApp.app)
      .get(ME_PATH)
      .set(bearer(loginResponse.body.data.accessToken as string));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        id: ADMIN_ID,
        organizationId: ORGANIZATION_ID,
        email: ADMIN_EMAIL,
        role: 'ADMIN',
      },
    });
  });

  it('reloads the role from storage instead of trusting the token claim', async () => {
    const testApp = await seededApp();
    const token = await testApp.signIn({
      id: ADMIN_ID,
      organizationId: ORGANIZATION_ID,
      role: 'ADMIN',
    });

    // Simulate a role change that happened after the token was issued.
    await testApp.seedUser({
      id: ADMIN_ID,
      email: ADMIN_EMAIL,
      password: TEST_PASSWORD,
      role: 'DISPATCHER',
    });

    const response = await request(testApp.app).get(ME_PATH).set(bearer(token));

    expect(response.status).toBe(200);
    expect(response.body.data.role).toBe('DISPATCHER');
  });

  it('returns 401 with the standard envelope when the token is absent or malformed', async () => {
    const testApp = await seededApp();

    const missing = await request(testApp.app).get(ME_PATH);
    const wrongScheme = await request(testApp.app)
      .get(ME_PATH)
      .set({ authorization: `Basic ${TEST_PASSWORD}` });
    const malformed = await request(testApp.app)
      .get(ME_PATH)
      .set(bearer('not-a-jwt'));

    for (const response of [missing, wrongScheme]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTH_TOKEN_MISSING');
      expect(response.body.error.correlationId).toBe(response.headers['x-request-id']);
    }

    expect(malformed.status).toBe(401);
    expect(malformed.body.error.code).toBe('IDENTITY_INVALID_TOKEN');
    expect(malformed.body.error.message).toBe('Access token is invalid');
    expect(JSON.stringify(malformed.body)).not.toContain('not-a-jwt');
  });

  it('rejects an expired token', async () => {
    const testApp = await seededApp();
    const now = Math.floor(Date.now() / 1000);
    const expired = await foreignAccessToken({ exp: now - 60, nbf: now - 120 });

    const response = await request(testApp.app).get(ME_PATH).set(bearer(expired));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('IDENTITY_INVALID_TOKEN');
  });

  it('rejects a token that is not valid yet', async () => {
    const testApp = await seededApp();
    const now = Math.floor(Date.now() / 1000);
    const notYetValid = await foreignAccessToken({
      nbf: now + 600,
      exp: now + 1200,
    });

    const response = await request(testApp.app).get(ME_PATH).set(bearer(notYetValid));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('IDENTITY_INVALID_TOKEN');
  });

  it('rejects a token signed with another secret or for another audience', async () => {
    const testApp = await seededApp();
    const otherSecret = await foreignAccessToken({
      secret: randomBytes(32).toString('hex'),
    });
    const otherAudience = await foreignAccessToken({ audience: 'another-app' });

    for (const token of [otherSecret, otherAudience]) {
      const response = await request(testApp.app).get(ME_PATH).set(bearer(token));
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('IDENTITY_INVALID_TOKEN');
    }
  });

  it('rejects a validly signed token whose user no longer exists', async () => {
    const testApp = await seededApp();
    const token = await testApp.signIn({
      id: ADMIN_ID,
      organizationId: OTHER_ORGANIZATION_ID,
      role: 'ADMIN',
    });

    const response = await request(testApp.app).get(ME_PATH).set(bearer(token));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_SESSION_INVALID');
  });
});
