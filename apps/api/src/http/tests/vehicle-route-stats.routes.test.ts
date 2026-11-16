import express from 'express';
import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { RouteStatsScope, VehicleRouteStats } from '../../infrastructure/dispatch/VehicleRouteStatsTypeOrmQuery.js';
import { createErrorHandler } from '../middleware/error-handler.js';
import { setAuthenticatedUser, type AuthenticatedUser } from '../request-context.js';
import { createVehicleRouteStatsRouter } from '../routes/vehicle-route-stats.routes.js';
import { bearer, buildTestApp, ORGANIZATION_ID as TEST_ORGANIZATION_ID } from './support/test-app.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const STATS: readonly VehicleRouteStats[] = [{
  vehicleId: 'vehicle-1', routes: 2, completed: 1, stops: 3, orders: 4, lastRouteDay: '2026-11-06',
  monthly: [{ month: '2026-10', routes: 1 }, { month: '2026-11', routes: 1 }],
}];

function statsApp(role: AuthenticatedUser['role'], getStats: (organizationId: string, scope: RouteStatsScope) => Promise<readonly VehicleRouteStats[]>) {
  const app = express();
  const user: AuthenticatedUser = {
    id: '33333333-3333-4333-8333-333333333331', organizationId: ORGANIZATION_ID,
    email: 'operator@example.test', role,
  };
  app.use('/api/v1/vehicles/route-stats', createVehicleRouteStatsRouter({ getStats }, (_request, response, next) => {
    setAuthenticatedUser(response, user);
    next();
  }));
  app.use(createErrorHandler(pino({ level: 'silent' })));
  return app;
}

describe('GET /api/v1/vehicles/route-stats', () => {
  it.each(['ADMIN', 'DISPATCHER'] as const)('returns tenant-scoped stats to %s, six months by default', async (role) => {
    const getStats = vi.fn().mockResolvedValue(STATS);

    const response = await request(statsApp(role, getStats)).get('/api/v1/vehicles/route-stats');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: STATS });
    expect(getStats).toHaveBeenCalledWith(ORGANIZATION_ID, { months: 6 });
  });

  it('passes the requested number of months', async () => {
    const getStats = vi.fn().mockResolvedValue([]);

    const response = await request(statsApp('ADMIN', getStats)).get('/api/v1/vehicles/route-stats?months=12');

    expect(response.status).toBe(200);
    expect(getStats).toHaveBeenCalledWith(ORGANIZATION_ID, { months: 12 });
  });

  it('passes an inclusive planned-day period and the vehicle ids of the visible page', async () => {
    const getStats = vi.fn().mockResolvedValue([]);
    const ids = ['22222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222'];

    const response = await request(statsApp('DISPATCHER', getStats)).get('/api/v1/vehicles/route-stats')
      .query({ from: '2026-11-01', to: '2026-11-30', ids: ids.join(',') });
    const sameDay = await request(statsApp('ADMIN', getStats)).get('/api/v1/vehicles/route-stats')
      .query({ from: '2026-11-16', to: '2026-11-16' });
    const openEnded = await request(statsApp('ADMIN', getStats)).get('/api/v1/vehicles/route-stats')
      .query({ from: '2026-01-01' });

    expect([response.status, sameDay.status, openEnded.status]).toEqual([200, 200, 200]);
    expect(getStats).toHaveBeenNthCalledWith(1, ORGANIZATION_ID, { months: 6, from: '2026-11-01', to: '2026-11-30', ids });
    expect(getStats).toHaveBeenNthCalledWith(2, ORGANIZATION_ID, { months: 6, from: '2026-11-16', to: '2026-11-16' });
    expect(getStats).toHaveBeenNthCalledWith(3, ORGANIZATION_ID, { months: 6, from: '2026-01-01' });
  });

  it.each([
    ['zero months', { months: '0' }],
    ['more than twelve months', { months: '13' }],
    ['a non-numeric value', { months: 'six' }],
    ['an unknown parameter', { vehicleId: 'vehicle-1' }],
    ['a malformed day', { from: '2026-11-1' }],
    ['an impossible day', { to: '2026-02-30' }],
    ['a period that ends before it starts', { from: '2026-11-30', to: '2026-11-01' }],
    ['a malformed id', { ids: 'vehicle-1' }],
  ])('rejects %s with 400 before querying', async (_label, query) => {
    const getStats = vi.fn().mockResolvedValue(STATS);

    const response = await request(statsApp('ADMIN', getStats)).get('/api/v1/vehicles/route-stats').query(query);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatchObject({ code: 'VEHICLE_INVALID_INPUT', message: 'Vehicle route stats query is invalid' });
    expect(getStats).not.toHaveBeenCalled();
  });

  it('is mounted in the app ahead of the vehicle catalog and scoped to the token organization', async () => {
    const getStats = vi.fn().mockResolvedValue(STATS);
    const testApp = buildTestApp({ vehicleRouteStats: { getStats } });
    await testApp.seedOrganization();
    const token = await testApp.signIn(await testApp.seedUser());

    const response = await request(testApp.app).get('/api/v1/vehicles/route-stats').query({ months: '3' })
      .set(bearer(token));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: STATS });
    expect(getStats).toHaveBeenCalledWith(TEST_ORGANIZATION_ID, { months: 3 });
    expect((await request(testApp.app).get('/api/v1/vehicles/route-stats')).status).toBe(401);
  });

  it('denies drivers before querying', async () => {
    const getStats = vi.fn().mockResolvedValue(STATS);

    const response = await request(statsApp('DRIVER', getStats)).get('/api/v1/vehicles/route-stats');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    expect(getStats).not.toHaveBeenCalled();
  });
});
