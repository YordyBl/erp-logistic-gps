import { describe, expect, it, vi } from 'vitest';

import { ValhallaRouteGeometryProvider } from '../infrastructure/ValhallaRouteGeometryProvider.js';

describe('ValhallaRouteGeometryProvider', () => {
  it('prepends a route origin before its delivery stops', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      routes: [{ distance: 3_000, duration: 300, geometry: {
        type: 'LineString', coordinates: [[-77.081446, -11.974070], [-77.042857, -11.959887]],
      } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = new ValhallaRouteGeometryProvider('http://valhalla:8002', fetcher);

    await provider.getGeometry([{ latitude: -11.9598866, longitude: -77.0428574 }],
      { latitude: -11.9740702, longitude: -77.0814464 });

    const request = JSON.parse(fetcher.mock.calls[0]![1]!.body as string) as {
      locations: { lat: number; lon: number }[];
    };
    expect(request.locations).toEqual([
      { lat: -11.9740702, lon: -77.0814464 },
      { lat: -11.9598866, lon: -77.0428574 },
    ]);
  });

  it('parses the configured OSRM response shape emitted by Valhalla', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      routes: [{
        distance: 10_696.828,
        duration: 674.826,
        geometry: {
          type: 'LineString',
          coordinates: [[-77.081370, -11.974103], [-77.081749, -11.974956], [-77.081944, -11.975377]],
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = new ValhallaRouteGeometryProvider('http://valhalla:8002', fetcher);

    await expect(provider.getGeometry([
      { latitude: -11.9740702, longitude: -77.0814464 },
      { latitude: -12.0464, longitude: -77.0428 },
    ])).resolves.toEqual({
      coordinates: [
        { latitude: -11.974103, longitude: -77.081370 },
        { latitude: -11.974956, longitude: -77.081749 },
        { latitude: -11.975377, longitude: -77.081944 },
      ],
      distanceMeters: 10_696.828,
      durationSeconds: 674.826,
    });
  });

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
