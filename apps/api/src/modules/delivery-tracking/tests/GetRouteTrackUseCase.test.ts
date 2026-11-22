import { describe, expect, it, vi } from 'vitest';

import { DeliveryRouteNotFoundError } from '../../delivery-routes/domain/errors/DeliveryRouteError.js';
import { GetRouteTrackUseCase, ROUTE_TRAIL_LIMIT, type RouteTrackDependencies, type TrackedRoute } from '../application/GetRouteTrackUseCase.js';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const ROUTE_ID = '00000000-0000-4000-8000-000000000002';
const query = { organizationId: ORGANIZATION_ID, routeId: ROUTE_ID };

const route: TrackedRoute = {
  status: 'in_progress',
  origin: { latitude: -12.0, longitude: -77.0 },
  stops: [
    { sequence: 2, latitude: -12.2, longitude: -77.2, orderIds: ['order-2'] },
    { sequence: 1, latitude: -12.1, longitude: -77.1, orderIds: ['order-1'] },
    { sequence: 3, latitude: -12.3, longitude: -77.3, orderIds: ['order-3'] },
  ],
};
const trail = [
  { latitude: -12.05, longitude: -77.05, recordedAt: '2026-11-14T10:00:00.000Z' },
  { latitude: -12.12, longitude: -77.12, recordedAt: '2026-11-14T10:05:00.000Z' },
];

function makeUseCase(overrides: Partial<RouteTrackDependencies> = {}) {
  const statuses: Record<string, string> = { 'order-1': 'delivered', 'order-2': 'in_transit', 'order-3': 'in_transit' };
  const dependencies: RouteTrackDependencies = {
    findRoute: vi.fn().mockResolvedValue(route),
    findOrderStatus: vi.fn(async (orderId: string) => statuses[orderId] ?? null),
    findTrail: vi.fn().mockResolvedValue(trail),
    geometry: { getGeometry: vi.fn().mockResolvedValue(null) },
    ...overrides,
  };
  return { useCase: new GetRouteTrackUseCase(dependencies), dependencies };
}

describe('GetRouteTrackUseCase', () => {
  it('returns the driven trail and joins the latest position to the stops still to visit', async () => {
    const { useCase, dependencies } = makeUseCase();

    const track = await useCase.execute(query);

    expect(dependencies.findTrail).toHaveBeenCalledWith(ORGANIZATION_ID, ROUTE_ID, ROUTE_TRAIL_LIMIT);
    expect(track).toEqual({
      traveled: trail,
      // Stop 1 is delivered, so the path goes from the latest position to stops 2 and 3, in sequence.
      pending: [{ latitude: -12.12, longitude: -77.12 }, { latitude: -12.2, longitude: -77.2 }, { latitude: -12.3, longitude: -77.3 }],
      pendingSource: 'straight',
    });
  });

  it('follows the roads when the routing engine draws the pending path', async () => {
    const roads = { coordinates: [{ latitude: -12.12, longitude: -77.12 }, { latitude: -12.15, longitude: -77.18 },
      { latitude: -12.3, longitude: -77.3 }], distanceMeters: 1000, durationSeconds: 120 };
    const getGeometry = vi.fn().mockResolvedValue(roads);
    const { useCase } = makeUseCase({ geometry: { getGeometry } });

    const track = await useCase.execute(query);

    expect(getGeometry).toHaveBeenCalledWith(
      [{ latitude: -12.2, longitude: -77.2 }, { latitude: -12.3, longitude: -77.3 }],
      { latitude: -12.12, longitude: -77.12 },
    );
    expect(track.pending).toEqual(roads.coordinates);
    expect(track.pendingSource).toBe('roads');
  });

  it('falls back to straight lines when the routing engine fails', async () => {
    const { useCase } = makeUseCase({ geometry: { getGeometry: vi.fn().mockRejectedValue(new Error('timeout')) } });

    expect((await useCase.execute(query)).pendingSource).toBe('straight');
  });

  it('starts the pending path at the route origin before any position arrives', async () => {
    const { useCase } = makeUseCase({ findTrail: vi.fn().mockResolvedValue([]) });

    const track = await useCase.execute(query);

    expect(track.traveled).toEqual([]);
    expect(track.pending[0]).toEqual({ latitude: -12.0, longitude: -77.0 });
  });

  it('has nothing pending once the route is completed or every stop is settled', async () => {
    const completed = makeUseCase({ findRoute: vi.fn().mockResolvedValue({ ...route, status: 'completed' }) });
    expect((await completed.useCase.execute(query)).pending).toEqual([]);

    const settled = makeUseCase({ findOrderStatus: vi.fn().mockResolvedValue('returned') });
    expect((await settled.useCase.execute(query)).pending).toEqual([]);
  });

  it('propagates a route the organization cannot see as not found', async () => {
    const { useCase, dependencies } = makeUseCase({ findRoute: vi.fn().mockRejectedValue(new DeliveryRouteNotFoundError()) });

    await expect(useCase.execute(query)).rejects.toBeInstanceOf(DeliveryRouteNotFoundError);
    expect(dependencies.findTrail).not.toHaveBeenCalled();
  });

  it('rejects an invalid route id', async () => {
    const { useCase } = makeUseCase();

    await expect(useCase.execute({ ...query, routeId: 'not-a-uuid' }))
      .rejects.toMatchObject({ code: 'DELIVERY_ROUTE_INVALID_INPUT' });
  });
});
