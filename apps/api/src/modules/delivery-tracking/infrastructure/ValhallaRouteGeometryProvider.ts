import type {
  RouteGeometry,
  RouteGeometryProvider,
  RoutePositionContext,
} from '../application/ports/PositionProvider.js';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface ValhallaResponse {
  readonly trip?: {
    readonly summary?: { readonly length?: unknown; readonly time?: unknown };
    readonly legs?: readonly { readonly shape?: unknown }[];
  };
}

/** Optional road geometry adapter. It never supplies actual driver positions. */
export class ValhallaRouteGeometryProvider implements RouteGeometryProvider {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly timeoutMilliseconds = 3_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async getGeometry(
    stops: RoutePositionContext['stops'],
  ): Promise<RouteGeometry | null> {
    const locations = stops.flatMap((stop) =>
      stop.latitude === null || stop.longitude === null
        ? []
        : [{ lat: stop.latitude, lon: stop.longitude }]);
    if (locations.length < 2 || locations.length !== stops.length) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMilliseconds);
    try {
      const response = await this.fetcher(`${this.baseUrl}/route`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          locations,
          costing: 'auto',
          units: 'kilometers',
          format: 'osrm',
          shape_format: 'geojson',
          directions_type: 'none',
        }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return parseGeometry(await response.json() as ValhallaResponse);
    } catch {
      // Planned geometry is optional; GPS ingestion and order progress continue.
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseGeometry(response: ValhallaResponse): RouteGeometry | null {
  const summary = response.trip?.summary;
  const lengthKilometers = summary?.length;
  const durationSeconds = summary?.time;
  const legs = response.trip?.legs;
  if (typeof lengthKilometers !== 'number' || !Number.isFinite(lengthKilometers) ||
      lengthKilometers <= 0 || typeof durationSeconds !== 'number' ||
      !Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Array.isArray(legs)) {
    return null;
  }

  const coordinates = legs.flatMap((leg) => {
    if (typeof leg.shape !== 'object' || leg.shape === null) return [];
    const shape = leg.shape as { readonly type?: unknown; readonly coordinates?: unknown };
    if (shape.type !== 'LineString' || !Array.isArray(shape.coordinates)) return [];
    return shape.coordinates.flatMap((coordinate): { latitude: number; longitude: number }[] => {
      if (!Array.isArray(coordinate) || coordinate.length < 2 ||
          typeof coordinate[0] !== 'number' || typeof coordinate[1] !== 'number') return [];
      const [longitude, latitude] = coordinate;
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
          !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return [];
      return [{ latitude, longitude }];
    });
  });
  if (coordinates.length < 2) return null;
  return { coordinates, distanceMeters: lengthKilometers * 1_000, durationSeconds };
}
