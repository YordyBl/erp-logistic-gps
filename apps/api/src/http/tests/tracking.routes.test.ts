import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { DeliveryRouteNotFoundError } from '../../modules/delivery-routes/domain/errors/DeliveryRouteError.js';
import type { RouteTrack } from '../../modules/delivery-tracking/application/GetRouteTrackUseCase.js';
import {
  ADMIN_EMAIL, ADMIN_ID, bearer, buildTestApp, DISPATCHER_EMAIL, DISPATCHER_ID, DRIVER_EMAIL, DRIVER_ID,
  ORGANIZATION_ID, TEST_PASSWORD, type TestAppOptions,
} from './support/test-app.js';

const ROUTE_ID = '00000000-0000-4000-8000-0000000000aa';
const PATH = `/api/v1/tracking/routes/${ROUTE_ID}/track`;
const track: RouteTrack = {
  traveled: [{ latitude: -12.1, longitude: -77.1, recordedAt: '2026-11-14T10:00:00.000Z' }],
  pending: [{ latitude: -12.1, longitude: -77.1 }, { latitude: -12.2, longitude: -77.2 }],
  pendingSource: 'straight',
};

async function setup(options: TestAppOptions = {}) {
  const testApp = buildTestApp(options);
  await testApp.seedOrganization();
  const seed = async (id: string, email: string, role: 'ADMIN' | 'DISPATCHER' | 'DRIVER') =>
    testApp.signIn(await testApp.seedUser({ id, email, password: TEST_PASSWORD, role }));
  return {
    app: testApp.app,
    adminToken: await seed(ADMIN_ID, ADMIN_EMAIL, 'ADMIN'),
    dispatcherToken: await seed(DISPATCHER_ID, DISPATCHER_EMAIL, 'DISPATCHER'),
    driverToken: await seed(DRIVER_ID, DRIVER_EMAIL, 'DRIVER'),
  };
}

describe('GET /api/v1/tracking/routes/:routeId/track', () => {
  it('returns the route track for operators, scoped to the token organization', async () => {
    const execute = vi.fn().mockResolvedValue(track);
    const { app, adminToken, dispatcherToken } = await setup({ routeTrack: { execute } });

    for (const token of [adminToken, dispatcherToken]) {
      const response = await request(app).get(PATH).set(bearer(token));
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: track });
      expect(response.headers['cache-control']).toBe('private, no-store');
    }
    expect(execute).toHaveBeenCalledWith({ organizationId: ORGANIZATION_ID, routeId: ROUTE_ID });
  });

  it('requires a token and an operator role', async () => {
    const execute = vi.fn().mockResolvedValue(track);
    const { app, driverToken } = await setup({ routeTrack: { execute } });

    expect((await request(app).get(PATH)).status).toBe(401);
    expect((await request(app).get(PATH).set(bearer(driverToken))).status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it('answers 404 for a route the organization cannot see and 503 when tracking is not composed', async () => {
    const notFound = await setup({ routeTrack: { execute: vi.fn().mockRejectedValue(new DeliveryRouteNotFoundError()) } });
    expect((await request(notFound.app).get(PATH).set(bearer(notFound.adminToken))).status).toBe(404);

    const unavailable = await setup();
    const response = await request(unavailable.app).get(PATH).set(bearer(unavailable.adminToken));
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('TRACKING_UNAVAILABLE');
  });
});
