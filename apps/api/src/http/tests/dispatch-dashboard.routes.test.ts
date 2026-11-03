import express from 'express';
import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { DispatchDashboardSummary } from '../../infrastructure/dispatch/DispatchDashboardTypeOrmQuery.js';
import { createErrorHandler } from '../middleware/error-handler.js';
import { setAuthenticatedUser, type AuthenticatedUser } from '../request-context.js';
import { createDispatchDashboardRouter } from '../routes/dispatch-dashboard.routes.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const SUMMARY: DispatchDashboardSummary = {
  ordersAwaitingPlanning: 2,
  routesInProgress: 1,
  deliveriesToday: 3,
  incidentsToday: 1,
  orderStatusCounts: {
    created: 1, planned: 0, assigned: 1, in_transit: 2, delivered: 3, returned: 1, cancelled: 0,
  },
  recentOrders: [{ id: 'order-1', publicCode: 'LIM-001', status: 'in_transit', createdAt: '2026-11-02T12:00:00.000Z' }],
  recentIncidents: [{ id: 'incident-1', orderId: 'order-2', publicCode: 'LIM-002', category: 'recipient_absent',
    description: 'No había nadie en el domicilio.', occurredAt: '2026-11-02T13:00:00.000Z' }],
  activeRoutes: [{ id: 'route-1', publicCode: 'R-001', plannedDate: '2026-11-02',
    lastPosition: { latitude: -12.05, longitude: -77.04, receivedAt: '2026-11-02T13:30:00.000Z' } }],
};

function dashboardApp(role: AuthenticatedUser['role'], getSummary: (organizationId: string) => Promise<DispatchDashboardSummary>) {
  const app = express();
  const user: AuthenticatedUser = {
    id: '33333333-3333-4333-8333-333333333331', organizationId: ORGANIZATION_ID,
    email: 'operator@example.test', role,
  };
  app.use('/api/v1/dashboard', createDispatchDashboardRouter({ getSummary }, (_request, response, next) => {
    setAuthenticatedUser(response, user);
    next();
  }));
  app.use(createErrorHandler(pino({ level: 'silent' })));
  return app;
}

describe('dispatcher dashboard HTTP', () => {
  it.each(['ADMIN', 'DISPATCHER'] as const)('returns tenant-scoped summary to %s', async (role) => {
    const getSummary = vi.fn().mockResolvedValue(SUMMARY);

    const response = await request(dashboardApp(role, getSummary)).get('/api/v1/dashboard');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(SUMMARY);
    expect(getSummary).toHaveBeenCalledWith(ORGANIZATION_ID);
  });

  it('denies dashboard access to drivers before querying operational data', async () => {
    const getSummary = vi.fn().mockResolvedValue(SUMMARY);

    const response = await request(dashboardApp('DRIVER', getSummary)).get('/api/v1/dashboard');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    expect(getSummary).not.toHaveBeenCalled();
  });
});
