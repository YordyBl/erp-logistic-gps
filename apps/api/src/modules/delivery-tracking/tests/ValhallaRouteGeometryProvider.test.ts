import { describe, expect, it, vi } from 'vitest';

import { ValhallaRouteGeometryProvider } from '../infrastructure/ValhallaRouteGeometryProvider.js';

describe('ValhallaRouteGeometryProvider', () => {
  it('requests optional road geometry and converts Valhalla distance to meters', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      trip: {
        summary: { length: 1.25, time: 300 },
        legs: [{ shape: { type: 'LineString', coordinates: [[-77.02, -12.01], [-77, -12]] } }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = new ValhallaRouteGeometryProvider('http://valhalla:8002', fetcher);

    await expect(provider.getGeometry([
      { latitude: -12, longitude: -77 },
      { latitude: -12.01, longitude: -77.02 },
    ])).resolves.toEqual({
      coordinates: [
        { latitude: -12.01, longitude: -77.02 },
        { latitude: -12, longitude: -77 },
      ],
      distanceMeters: 1_250,
      durationSeconds: 300,
    });
    expect(fetcher).toHaveBeenCalledWith('http://valhalla:8002/route', expect.objectContaining({
      method: 'POST',
    }));
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string) as {
      locations: { lat: number; lon: number }[];
    };
    expect(body.locations).toEqual([
      { lat: -12, lon: -77 },
      { lat: -12.01, lon: -77.02 },
    ]);
  });

  it('returns no geometry when Valhalla is unavailable or responds with invalid data', async () => {
    const unavailable = new ValhallaRouteGeometryProvider('http://valhalla:8002',
      vi.fn().mockRejectedValue(new Error('connection refused')));
    await expect(unavailable.getGeometry([
      { latitude: -12, longitude: -77 },
      { latitude: -12.01, longitude: -77.02 },
    ])).resolves.toBeNull();
  });
});
