import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_EMAIL,
  ADMIN_ID,
  bearer,
  buildTestApp,
  createFailingRepository,
  type TestAppOptions,
  validOrderBody,
} from './support/test-app.js';
import {
  captureLogger,
  parseLogLine,
  waitForLog,
} from './support/log-capture.js';

async function buildSeededApp(options: TestAppOptions = {}) {
  const testApp = buildTestApp({ ...options, seedTestCustomer: true });

  await testApp.seedOrganization();
  const admin = await testApp.seedUser({ id: ADMIN_ID, email: ADMIN_EMAIL });

  return { app: testApp.app, token: await testApp.signIn(admin) };
}

describe('HTTP error handling', () => {
  it('returns a consistent 404 envelope for an unknown route', async () => {
    const { app } = await buildSeededApp();

    const response = await request(app).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(response.body.error.message).toBe('The requested route does not exist');
    expect(response.body.error.correlationId).toBe(
      response.headers['x-request-id'],
    );
  });

  it('returns 400 for malformed JSON instead of an unhandled 500', async () => {
    const { app, token } = await buildSeededApp();

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(bearer(token))
      .set('content-type', 'application/json')
      .send('{"publicCode":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });

  it('logging in with a malformed JSON body is a 400, not a 500', async () => {
    const { app } = await buildSeededApp();

    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('content-type', 'application/json')
      .send('{"email":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });

  it('logs the adapter failure but returns a generic 500 message', async () => {
    const { logger, lines } = captureLogger();
    const { app, token } = await buildSeededApp({
      repository: createFailingRepository('database connection lost'),
      logger,
    });

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(bearer(token))
      .send(validOrderBody());

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body.error.message).toBe(
      'An unexpected error occurred while processing the request',
    );
    expect(response.body.error.correlationId).toBe(
      response.headers['x-request-id'],
    );

    const errorLine = await waitForLog(lines, (line) =>
      line.includes('unexpected error while handling request'),
    );
    const record = parseLogLine<Record<string, unknown>>(errorLine);

    expect(record.level).toBe(50);
    expect(JSON.stringify(record)).toContain('database connection lost');
  });

  it('never leaks the Authorization header or the refresh cookie into logs', async () => {
    const { logger, lines } = captureLogger();
    const { app } = await buildSeededApp({ logger });

    const token = 'header.payload.signature';
    await request(app)
      .get('/api/v1/auth/me')
      .set(bearer(token))
      .set('cookie', 'erp_refresh_token=refresh-secret-value');

    const requestLine = await waitForLog(lines, (line) =>
      line.includes('"req"'),
    );

    expect(requestLine).not.toContain(token);
    expect(requestLine).not.toContain('refresh-secret-value');
    expect(requestLine).toContain('[Redacted]');
  });
});

describe('HTTP error envelope details', () => {
  it('rejects a request to a protected route with the same envelope shape', async () => {
    const { app } = await buildSeededApp();

    const response = await request(app).get('/api/v1/delivery-orders');

    expect(response.status).toBe(401);
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.body).toEqual({
      error: {
        code: 'AUTH_TOKEN_MISSING',
        message: 'The Authorization header with a Bearer access token is required',
        correlationId: response.headers['x-request-id'],
      },
    });
  });
});
