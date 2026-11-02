import { describe, expect, it } from 'vitest';

import { SimulatedPositionProvider } from '../application/SimulatedPositionProvider.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const ROUTE_ID = '22222222-2222-4222-8222-222222222222';
const DRIVER_ID = '33333333-3333-4333-8333-333333333333';
const STARTED_AT = '2026-11-02T12:00:00.000Z';
const RECORDED_AT = '2026-11-02T12:00:50.000Z';
const RECEIVED_AT = '2026-11-02T12:00:05.250Z';

describe('SimulatedPositionProvider', () => {
  it('samples route geometry without coupling the position source to navigation', async () => {
    const provider = new SimulatedPositionProvider({
      getGeometry: async () => ({
        coordinates: [
          { latitude: -12, longitude: -77 },
          { latitude: -12, longitude: -76.991 },
        ],
        distanceMeters: 1_000,
        durationSeconds: 100,
      }),
    }, { now: () => RECEIVED_AT });

    const position = await provider.sample({
      organizationId: ORGANIZATION_ID,
      routeId: ROUTE_ID,
      driverId: DRIVER_ID,
      startedAt: STARTED_AT,
      stops: [
        { latitude: -12, longitude: -77 },
        { latitude: -12, longitude: -76.991 },
      ],
    }, RECORDED_AT);

    expect(position).toMatchObject({
      organizationId: ORGANIZATION_ID,
      routeId: ROUTE_ID,
      driverId: DRIVER_ID,
      latitude: -12,
      accuracyMeters: 5,
      speedMetersPerSecond: 10,
      source: 'simulated',
      recordedAt: RECORDED_AT,
      receivedAt: RECEIVED_AT,
    });
    expect(position?.longitude).toBeCloseTo(-76.9955, 8);
  });
});
