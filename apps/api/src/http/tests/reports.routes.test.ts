import express from 'express';
import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { OperationsReport, OperationsReportRequest } from '../../infrastructure/dispatch/OperationsReportTypeOrmQuery.js';
import { createErrorHandler } from '../middleware/error-handler.js';
import { setAuthenticatedUser, type AuthenticatedUser } from '../request-context.js';
import { createReportsRouter } from '../routes/reports.routes.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const KPIS = {
  orders: 4, closedAttempts: 3, delivered: 2, returned: 1, firstAttempts: 3, firstAttemptDelivered: 2,
  avgStopSeconds: 660, timedStops: 3, simulatedAttempts: 0,
};
const REPORT: OperationsReport = {
  period: { from: '2026-11-01', to: '2026-11-18' },
  comparison: { from: '2026-10-01', to: '2026-10-18' },
  includeSimulated: false,
  kpis: KPIS,
  comparisonKpis: { ...KPIS, orders: 2 },
  weekly: [{ weekStart: '2026-11-16', delivered: 2, returned: 1, cancelled: 0 }],
  incidents: [{ category: 'recipient_absent', count: 1 }],
  districts: [{ district: 'Miraflores', orders: 3, firstAttempts: 3, firstAttemptDelivered: 2, closedAttempts: 3, returned: 1 }],
  drivers: [],
};

function reportsApp(role: AuthenticatedUser['role'], getReport: (organizationId: string, request: OperationsReportRequest) => Promise<OperationsReport>) {
  const app = express();
  const user: AuthenticatedUser = {
    id: '33333333-3333-4333-8333-333333333331', organizationId: ORGANIZATION_ID, email: 'operator@example.test', role,
  };
  app.use('/api/v1/reports', createReportsRouter({ getReport }, (_request, response, next) => {
    setAuthenticatedUser(response, user);
    next();
  }));
  app.use(createErrorHandler(pino({ level: 'silent' })));
  return app;
}

describe('GET /api/v1/reports/operations', () => {
  it.each(['ADMIN', 'DISPATCHER'] as const)('returns the tenant report with its comparison to %s', async (role) => {
    const getReport = vi.fn().mockResolvedValue(REPORT);

    const response = await request(reportsApp(role, getReport)).get('/api/v1/reports/operations')
      .query({ from: '2026-11-01', to: '2026-11-18', compareFrom: '2026-10-01', compareTo: '2026-10-18' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(REPORT);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(getReport).toHaveBeenCalledWith(ORGANIZATION_ID, {
      period: { from: '2026-11-01', to: '2026-11-18' },
      comparison: { from: '2026-10-01', to: '2026-10-18' },
      includeSimulated: false,
    });
  });

  it('passes includeSimulated and works without a comparison period', async () => {
    const getReport = vi.fn().mockResolvedValue(REPORT);

    await request(reportsApp('ADMIN', getReport)).get('/api/v1/reports/operations')
      .query({ from: '2026-11-12', to: '2026-11-18', includeSimulated: 'true' });

    expect(getReport).toHaveBeenCalledWith(ORGANIZATION_ID, {
      period: { from: '2026-11-12', to: '2026-11-18' }, comparison: null, includeSimulated: true,
    });
  });

  it('denies drivers before querying', async () => {
    const getReport = vi.fn().mockResolvedValue(REPORT);

    const response = await request(reportsApp('DRIVER', getReport)).get('/api/v1/reports/operations')
      .query({ from: '2026-11-01', to: '2026-11-18' });

    expect(response.status).toBe(403);
    expect(getReport).not.toHaveBeenCalled();
  });

  it.each([
    ['missing dates', {}],
    ['a reversed period', { from: '2026-11-18', to: '2026-11-01' }],
    ['an impossible day', { from: '2026-02-30', to: '2026-03-01' }],
    ['a period over 366 days', { from: '2025-01-01', to: '2026-01-02' }],
    ['half a comparison', { from: '2026-11-01', to: '2026-11-18', compareFrom: '2026-10-01' }],
    ['an unknown parameter', { from: '2026-11-01', to: '2026-11-18', days: '7' }],
  ])('rejects %s with 400', async (_label, query) => {
    const getReport = vi.fn().mockResolvedValue(REPORT);

    const response = await request(reportsApp('ADMIN', getReport)).get('/api/v1/reports/operations').query(query);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('REPORT_INVALID_QUERY');
    expect(getReport).not.toHaveBeenCalled();
  });
});
