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
  /**
   * Simulation only: how many stops, in sequence order, the simulated vehicle
   * has passed at `recordedAt`. Never persisted and never set by real devices.
   */
  readonly reachedStopCount?: number;
}

export interface RoutePositionContext {
  readonly organizationId: string;
  readonly routeId: string;
  readonly driverId: string;
  readonly simulatedCompletionEnabled?: boolean;
  /** Dispatcher who planned the simulated route; the audited actor of simulated outcomes. */
  readonly simulationActorUserId?: string;
  readonly startedAt: string;
  readonly origin?: { readonly latitude: number; readonly longitude: number };
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
  /** Distance of each leg between consecutive route locations, in travel order, when known. */
  readonly legDistancesMeters?: readonly number[];
}

export interface RouteGeometryProvider {
  getGeometry(
    stops: RoutePositionContext['stops'],
    origin?: RoutePositionContext['origin'],
  ): Promise<RouteGeometry | null>;
}

/** Source adapter that samples a position for an active route at a given instant. */
export interface PositionProvider {
  sample(route: RoutePositionContext, recordedAt: string): Promise<RoutePosition | null>;
}
