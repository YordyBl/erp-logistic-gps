import { z } from 'zod';

import { DeliveryRouteValidationError } from '../../delivery-routes/domain/errors/DeliveryRouteError.js';
import type { RouteGeometryProvider } from './ports/PositionProvider.js';

/** Most positions returned for one route; the most recent ones are kept. */
export const ROUTE_TRAIL_LIMIT = 2_000;

/** Order statuses after which a stop needs no further visit. */
const SETTLED_ORDER_STATUSES: ReadonlySet<string> = new Set(['delivered', 'returned', 'cancelled']);

export interface TrackPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface TrailPoint extends TrackPoint {
  readonly recordedAt: string;
}

export interface RouteTrack {
  /** Recorded positions in travel order (oldest first). */
  readonly traveled: readonly TrailPoint[];
  /** From the current position through the stops still to visit, in sequence order. */
  readonly pending: readonly TrackPoint[];
  /** `roads` when a routing engine drew `pending`; `straight` when it joins stops directly. */
  readonly pendingSource: 'roads' | 'straight';
}

/** The route as planned: the route module already enforces the tenant (foreign routes are not found). */
export interface TrackedRoute {
  readonly status: 'planned' | 'in_progress' | 'completed';
  readonly origin?: TrackPoint;
  readonly stops: readonly {
    readonly sequence: number;
    readonly latitude: number | null;
    readonly longitude: number | null;
    readonly orderIds: readonly string[];
  }[];
}

export interface RouteTrackDependencies {
  readonly findRoute: (organizationId: string, routeId: string) => Promise<TrackedRoute>;
  readonly findOrderStatus: (orderId: string) => Promise<string | null>;
  readonly findTrail: (organizationId: string, routeId: string, limit: number) => Promise<readonly TrailPoint[]>;
  readonly geometry: RouteGeometryProvider;
}

const querySchema = z.strictObject({ organizationId: z.uuid(), routeId: z.uuid() });

/** Path already driven and path still ahead for one route, for the control tower map. */
export class GetRouteTrackUseCase {
  constructor(private readonly dependencies: RouteTrackDependencies) {}

  async execute(input: unknown): Promise<RouteTrack> {
    const parsed = querySchema.safeParse(input);
    if (!parsed.success) {
      throw new DeliveryRouteValidationError('Get route track query is invalid', {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })),
      });
    }
    const { organizationId, routeId } = parsed.data;
    const route = await this.dependencies.findRoute(organizationId, routeId);
    const traveled = await this.dependencies.findTrail(organizationId, routeId, ROUTE_TRAIL_LIMIT);
    if (route.status === 'completed') return { traveled, pending: [], pendingSource: 'straight' };

    const remaining = await this.remainingStops(route);
    const latest = traveled.at(-1);
    const start: TrackPoint | undefined = latest === undefined
      ? route.origin : { latitude: latest.latitude, longitude: latest.longitude };
    if (remaining.length === 0) return { traveled, pending: [], pendingSource: 'straight' };

    // Routing is optional: without an engine (or if it fails) the stops are joined directly.
    const roads = await this.dependencies.geometry.getGeometry(remaining, start).catch(() => null);
    if (roads !== null && roads.coordinates.length >= 2) {
      return { traveled, pending: roads.coordinates, pendingSource: 'roads' };
    }
    return { traveled, pending: [...(start === undefined ? [] : [start]), ...remaining], pendingSource: 'straight' };
  }

  /** Stops with coordinates that still hold at least one order without a final outcome. */
  private async remainingStops(route: TrackedRoute): Promise<TrackPoint[]> {
    const stops = [...route.stops].sort((left, right) => left.sequence - right.sequence);
    const remaining: TrackPoint[] = [];
    for (const stop of stops) {
      if (stop.latitude === null || stop.longitude === null) continue;
      const statuses = await Promise.all(stop.orderIds.map((orderId) => this.dependencies.findOrderStatus(orderId)));
      if (statuses.some((status) => status !== null && !SETTLED_ORDER_STATUSES.has(status))) {
        remaining.push({ latitude: stop.latitude, longitude: stop.longitude });
      }
    }
    return remaining;
  }
}
