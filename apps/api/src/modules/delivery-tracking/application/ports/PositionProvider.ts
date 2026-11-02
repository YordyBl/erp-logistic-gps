export type PositionSource = 'simulated' | 'mobile';

export interface RoutePosition {
  readonly organizationId: string;
  readonly routeId: string;
  readonly driverId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number;
  readonly speedMetersPerSecond: number;
  readonly source: PositionSource;
  readonly recordedAt: string;
  readonly receivedAt: string;
}

export interface RoutePositionContext {
  readonly organizationId: string;
  readonly routeId: string;
  readonly driverId: string;
  readonly startedAt: string;
  readonly stops: readonly {
    readonly latitude: number | null;
    readonly longitude: number | null;
  }[];
}

export interface RouteGeometry {
  /** Coordinates in travel order, independent of any driver's navigation app. */
  readonly coordinates: readonly {
    readonly latitude: number;
    readonly longitude: number;
  }[];
  readonly distanceMeters: number;
  readonly durationSeconds: number;
}

export interface RouteGeometryProvider {
  getGeometry(stops: RoutePositionContext['stops']): Promise<RouteGeometry | null>;
}

/** Source adapter that samples a position for an active route at a given instant. */
export interface PositionProvider {
  sample(route: RoutePositionContext, recordedAt: string): Promise<RoutePosition | null>;
}
