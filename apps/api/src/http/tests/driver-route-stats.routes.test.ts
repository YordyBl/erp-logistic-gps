import express from 'express';
import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { DriverRouteStats } from '../../infrastructure/dispatch/DriverRouteStatsTypeOrmQuery.js';
import type { RouteStatsScope } from '../../infrastructure/dispatch/RouteStatsTypeOrmQuery.js';
import { createErrorHandler } from '../middleware/error-handler.js';
import { setAuthenticatedUser, type AuthenticatedUser } from '../request-context.js';
import { createDriverRouteStatsRouter } from '../routes/driver-route-stats.routes.js';
import { bearer, buildTestApp, ORGANIZATION_ID as TEST_ORGANIZATION_ID } from './support/test-app.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const STATS: readonly DriverRouteStats[] = [{
  driverId: 'driver-1', routes: 4, completed: 3, stops: 9, orders: 11, lastRouteDay: '2026-11-14',
  monthly: [{ month: '2026-10', routes: 1 }, { month: '2026-11', routes: 3 }],
}];

function statsApp(role: AuthenticatedUser['role'], getStats: (organizationId: string, scope: RouteStatsScope) => Promise<readonly DriverRouteStats[]>) {
  const app = express();
  const user: AuthenticatedUser = {
    id: '33333333-3333-4333-8333-333333333331', organizationId: ORGANIZATION_ID,
    email: 'operator@example.test', role,
  };
  app.use('/api/v1/drivers/route-stats', createDriverRouteStatsRouter({ getStats }, (_request, response, next) => {
    setAuthenticatedUser(response, user);
    next();
  }));
  app.use(createErrorHandler(pino({ level: 'silent' })));
  return app;
}

describe('GET /api/v1/drivers/route-stats', () => {
  it.each(['ADMIN', 'DISPATCHER'] as const)('returns tenant-scoped trips to %s with the period and visible drivers', async (role) => {
    const getStats = vi.fn().mockResolvedValue(STATS);
    const ids = ['22222222-2222-4222-8222-222222222221'];

    const all = await request(statsApp(role, getStats)).get('/api/v1/drivers/route-stats');
    const scoped = await request(statsApp(role, getStats)).get('/api/v1/drivers/route-stats')
      .query({ from: '2026-11-01', to: '2026-11-30', ids: ids.join(','), months: '3' });

    expect(all.status).toBe(200);
    expect(all.body).toEqual({ data: STATS });
    expect(getStats).toHaveBeenNthCalledWith(1, ORGANIZATION_ID, { months: 6 });
    expect(scoped.status).toBe(200);
    expect(getStats).toHaveBeenNthCalledWith(2, ORGANIZATION_ID, { months: 3, from: '2026-11-01', to: '2026-11-30', ids });
  });

  it.each([
    ['more than twelve months', { months: '13' }],
    ['an impossible day', { from: '2026-13-01' }],
    ['a period that ends before it starts', { from: '2026-11-30', to: '2026-11-01' }],
    ['an unknown parameter', { driverId: 'driver-1' }],
  ])('rejects %s with the driver 400 before querying', async (_label, query) => {
    const getStats = vi.fn().mockResolvedValue(STATS);

    const response = await request(statsApp('ADMIN', getStats)).get('/api/v1/drivers/route-stats').query(query);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'DRIVER_INVALID_INPUT', message: 'Driver route stats query is invalid' });
    expect(getStats).not.toHaveBeenCalled();
  });

  it('denies drivers before querying', async () => {
    const getStats = vi.fn().mockResolvedValue(STATS);

    const response = await request(statsApp('DRIVER', getStats)).get('/api/v1/drivers/route-stats');

    expect(response.status).toBe(403);
    expect(getStats).not.toHaveBeenCalled();
  });

  it('is mounted in the app ahead of the driver catalog and scoped to the token organization', async () => {
    const getStats = vi.fn().mockResolvedValue(STATS);
    const testApp = buildTestApp({ driverRouteStats: { getStats } });
    await testApp.seedOrganization();
    const token = await testApp.signIn(await testApp.seedUser());

    const response = await request(testApp.app).get('/api/v1/drivers/route-stats').set(bearer(token));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: STATS });
    expect(getStats).toHaveBeenCalledWith(TEST_ORGANIZATION_ID, { months: 6 });
    expect((await request(testApp.app).get('/api/v1/drivers/route-stats')).status).toBe(401);
  });
});
