import { describe, expect, it, vi } from 'vitest';

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

  it('starts from the persisted origin and supports a local accelerated demonstration scale', async () => {
    const getGeometry = vi.fn(async () => ({
      coordinates: [
        { latitude: -11.9740702, longitude: -77.0814464 },
        { latitude: -11.9598866, longitude: -77.0428574 },
      ],
      distanceMeters: 5_000,
      durationSeconds: 100,
    }));
    const provider = new SimulatedPositionProvider({ getGeometry }, { now: () => RECEIVED_AT }, 5, 2);
    const origin = { latitude: -11.9740702, longitude: -77.0814464 };
    const destination = { latitude: -11.9598866, longitude: -77.0428574 };

    const position = await provider.sample({
      organizationId: ORGANIZATION_ID, routeId: ROUTE_ID, driverId: DRIVER_ID,
      startedAt: STARTED_AT, origin, stops: [destination],
    }, RECORDED_AT);

    expect(getGeometry).toHaveBeenCalledWith([destination], origin);
    expect(position).toMatchObject({ latitude: destination.latitude, longitude: destination.longitude });
  });

  describe('reached stops', () => {
    const coordinates = [
      { latitude: -12, longitude: -77 },
      { latitude: -12, longitude: -76.9 },
    ];
    const at = (seconds: number) => new Date(Date.parse(STARTED_AT) + seconds * 1_000).toISOString();
    const route = (stops: number, origin = true) => ({
      organizationId: ORGANIZATION_ID, routeId: ROUTE_ID, driverId: DRIVER_ID, startedAt: STARTED_AT,
      ...(origin ? { origin: { latitude: -12, longitude: -77 } } : {}),
      stops: Array.from({ length: stops }, (_, index) => ({ latitude: -12, longitude: -76.99 + index * 0.01 })),
    });

    it('counts every stop whose leg boundary the simulated progress has passed', async () => {
      const provider = new SimulatedPositionProvider({ getGeometry: async () => ({
        coordinates, distanceMeters: 4_000, durationSeconds: 400, legDistancesMeters: [1_000, 1_000, 2_000],
      }) }, { now: () => RECEIVED_AT });

      const counts = [];
      for (const seconds of [0, 99, 100, 150, 200, 399, 400, 900]) {
        counts.push((await provider.sample(route(3), at(seconds)))?.reachedStopCount);
      }

      expect(counts).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    });

    it('treats the first stop as reached at the start when the route has no origin', async () => {
      const provider = new SimulatedPositionProvider({ getGeometry: async () => ({
        coordinates, distanceMeters: 2_000, durationSeconds: 200, legDistancesMeters: [1_000, 1_000],
      }) }, { now: () => RECEIVED_AT });

      const counts = [];
      for (const seconds of [0, 100, 200]) {
        counts.push((await provider.sample(route(3, false), at(seconds)))?.reachedStopCount);
      }

      expect(counts).toEqual([1, 2, 3]);
    });

    it('reaches every stop only at the end when the geometry has no usable leg distances', async () => {
      const provider = new SimulatedPositionProvider({ getGeometry: async () => ({
        coordinates, distanceMeters: 2_000, durationSeconds: 200,
      }) }, { now: () => RECEIVED_AT });

      expect((await provider.sample(route(2), at(199)))?.reachedStopCount).toBe(0);
      expect((await provider.sample(route(2), at(200)))?.reachedStopCount).toBe(2);
    });

    it('skips several stops in one sample at an accelerated time scale', async () => {
      const provider = new SimulatedPositionProvider({ getGeometry: async () => ({
        coordinates, distanceMeters: 4_000, durationSeconds: 400, legDistancesMeters: [1_000, 1_000, 2_000],
      }) }, { now: () => RECEIVED_AT }, 5, 100);

      expect((await provider.sample(route(3), at(3)))?.reachedStopCount).toBe(2);
    });
  });
});
