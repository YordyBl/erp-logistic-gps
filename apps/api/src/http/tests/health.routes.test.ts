import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildTestApp } from './support/test-app.js';

describe('GET /healthz', () => {
  it('returns 200 while the database is unreachable', async () => {
    const { app } = buildTestApp({
      readiness: async () => {
        throw new Error('database connection refused');
      },
    });

    const response = await request(app).get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});

describe('GET /readyz', () => {
  it('returns 200 when the readiness probe succeeds', async () => {
    const { app } = buildTestApp({ readiness: async () => undefined });

    const response = await request(app).get('/readyz');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ready',
      checks: { database: 'up' },
    });
  });

  it('returns 503 without leaking the probe error when the readiness probe fails', async () => {
    const { app } = buildTestApp({
      readiness: async () => {
        throw new Error('password authentication failed for user "erp_logistic"');
      },
    });

    const response = await request(app).get('/readyz');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'not_ready',
      checks: { database: 'down' },
    });
    expect(JSON.stringify(response.body)).not.toContain('password authentication');
  });
});
