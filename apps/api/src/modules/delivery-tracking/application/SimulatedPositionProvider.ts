import { SystemClock, type Clock } from '../../../shared/clock.js';
import type {
  PositionProvider,
  RouteGeometry,
  RouteGeometryProvider,
  RoutePosition,
  RoutePositionContext,
} from './ports/PositionProvider.js';

const DEFAULT_ACCURACY_METERS = 5;
const EARTH_RADIUS_METERS = 6_371_000;

export class SimulatedPositionProvider implements PositionProvider {
  constructor(
    private readonly geometryProvider: RouteGeometryProvider,
    private readonly clock: Clock = new SystemClock(),
    private readonly accuracyMeters = DEFAULT_ACCURACY_METERS,
    private readonly timeScale = 1,
  ) {}

  async sample(
    route: RoutePositionContext,
    recordedAt: string,
  ): Promise<RoutePosition | null> {
    const instant = Date.parse(recordedAt);
    const startedAt = Date.parse(route.startedAt);
    if (!Number.isFinite(instant) || !Number.isFinite(startedAt)) return null;
    if (route.stops.length === 0 || route.stops.some((stop) =>
      stop.latitude === null || stop.longitude === null)) return null;
    if (route.origin === undefined && route.stops.length < 2) return null;

    const geometry = await this.geometryProvider.getGeometry(route.stops, route.origin);
    if (!isUsableGeometry(geometry)) return null;

    const elapsedSeconds = Math.max(0, (instant - startedAt) / 1_000) * this.timeScale;
    const progress = Math.min(1, elapsedSeconds / geometry.durationSeconds);
    const coordinate = coordinateAtProgress(geometry, progress);
    if (coordinate === null) return null;

    return {
      organizationId: route.organizationId,
      routeId: route.routeId,
      driverId: route.driverId,
      ...coordinate,
      accuracyMeters: this.accuracyMeters,
      speedMetersPerSecond: geometry.distanceMeters / geometry.durationSeconds,
      source: 'simulated',
      recordedAt: new Date(instant).toISOString(),
      receivedAt: this.clock.now(),
    };
  }
}

function isUsableGeometry(geometry: RouteGeometry | null): geometry is RouteGeometry {
  return geometry !== null && geometry.coordinates.length >= 2 &&
    geometry.coordinates.every(({ latitude, longitude }) =>
      Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
      Number.isFinite(longitude) && longitude >= -180 && longitude <= 180) &&
    Number.isFinite(geometry.distanceMeters) && geometry.distanceMeters > 0 &&
    Number.isFinite(geometry.durationSeconds) && geometry.durationSeconds > 0;
}

function coordinateAtProgress(
  geometry: RouteGeometry,
  progress: number,
): { readonly latitude: number; readonly longitude: number } | null {
  const points = geometry.coordinates;
  const lengths = points.slice(1).map((point, index) => distanceMeters(points[index]!, point));
  const measuredLength = lengths.reduce((sum, length) => sum + length, 0);
  if (!Number.isFinite(measuredLength) || measuredLength <= 0) return null;

  const targetDistance = measuredLength * progress;
  let traversedDistance = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const segmentLength = lengths[index]!;
    if (targetDistance <= traversedDistance + segmentLength || index === lengths.length - 1) {
      const fraction = segmentLength === 0
        ? 0
        : Math.min(1, Math.max(0, (targetDistance - traversedDistance) / segmentLength));
      const start = points[index]!;
      const end = points[index + 1]!;
      return {
        latitude: interpolate(start.latitude, end.latitude, fraction),
        longitude: interpolate(start.longitude, end.longitude, fraction),
      };
    }
    traversedDistance += segmentLength;
  }
  return null;
}

function distanceMeters(
  start: { readonly latitude: number; readonly longitude: number },
  end: { readonly latitude: number; readonly longitude: number },
): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(end.latitude - start.latitude);
  const longitudeDelta = toRadians(end.longitude - start.longitude);
  const startLatitude = toRadians(start.latitude);
  const endLatitude = toRadians(end.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

function interpolate(start: number, end: number, fraction: number): number {
  return start + (end - start) * fraction;
}
