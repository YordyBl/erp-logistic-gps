import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildTestApp } from './support/test-app.js';
import { captureLogger, parseLogLine, waitForLog } from './support/log-capture.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RequestLogRecord {
  readonly level: number;
  readonly time: string;
  readonly msg: string;
  readonly req: {
    readonly id: string;
    readonly headers: Record<string, string>;
  };
}

async function completedRequestRecord(
  lines: readonly string[],
): Promise<RequestLogRecord> {
  const line = await waitForLog(lines, (candidate) =>
    candidate.includes('"msg":"request completed"'),
  );
  return parseLogLine<RequestLogRecord>(line);
}

describe('request logging and correlation ids', () => {
  it('generates an x-request-id, echoes it and logs it in Lima time', async () => {
    const { logger, lines } = captureLogger();
    const { app } = buildTestApp({ logger });

    const response = await request(app).get('/healthz');
    const requestId = response.headers['x-request-id'];

    expect(typeof requestId).toBe('string');
    expect(requestId).toMatch(UUID_PATTERN);

    const record = await completedRequestRecord(lines);
    expect(record.req.id).toBe(requestId);
    expect(record.time).toMatch(/-05:00$/);
    expect(record.time).toContain('T');
  });

  it('honors an incoming x-request-id', async () => {
    const { logger, lines } = captureLogger();
    const { app } = buildTestApp({ logger });

    const response = await request(app)
      .get('/healthz')
      .set('x-request-id', 'dispatcher-request-42');

    expect(response.headers['x-request-id']).toBe('dispatcher-request-42');

    const record = await completedRequestRecord(lines);
    expect(record.req.id).toBe('dispatcher-request-42');
  });

  it('replaces an unsafe incoming x-request-id with a generated one', async () => {
    const { logger } = captureLogger();
    const { app } = buildTestApp({ logger });

    const response = await request(app)
      .get('/healthz')
      .set('x-request-id', 'not a safe id with spaces');

    const requestId = response.headers['x-request-id'];
    expect(requestId).toMatch(UUID_PATTERN);
    expect(requestId).not.toBe('not a safe id with spaces');
  });

  it('redacts authorization and cookie headers from structured logs', async () => {
    const { logger, lines } = captureLogger();
    const { app } = buildTestApp({ logger });

    const response = await request(app)
      .get('/healthz')
      .set('authorization', 'Bearer super-secret-token')
      .set('cookie', 'refresh_token=cookie-secret');

    expect(response.status).toBe(200);

    const record = await completedRequestRecord(lines);
    expect(record.req.headers.authorization).toBe('[Redacted]');
    expect(record.req.headers.cookie).toBe('[Redacted]');
    expect(lines.join('\n')).not.toContain('super-secret-token');
    expect(lines.join('\n')).not.toContain('cookie-secret');
  });
});
