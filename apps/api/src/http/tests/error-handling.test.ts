import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  buildTestApp,
  createFailingRepository,
  ORGANIZATION_HEADER,
  ORGANIZATION_ID,
  validOrderBody,
} from './support/test-app.js';
import {
  captureLogger,
  parseLogLine,
  waitForLog,
} from './support/log-capture.js';

describe('HTTP error handling', () => {
  it('returns a consistent 404 envelope for an unknown route', async () => {
    const { app } = buildTestApp();

    const response = await request(app).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(response.body.error.message).toBe('The requested route does not exist');
    expect(response.body.error.correlationId).toBe(
      response.headers['x-request-id'],
    );
  });

  it('returns 400 for malformed JSON instead of an unhandled 500', async () => {
    const { app } = buildTestApp();

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID)
      .set('content-type', 'application/json')
      .send('{"publicCode":');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });

  it('logs the adapter failure but returns a generic 500 message', async () => {
    const { logger, lines } = captureLogger();
    const { app } = buildTestApp({
      repository: createFailingRepository('database connection lost'),
      logger,
    });

    const response = await request(app)
      .post('/api/v1/delivery-orders')
      .set(ORGANIZATION_HEADER, ORGANIZATION_ID)
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
});
