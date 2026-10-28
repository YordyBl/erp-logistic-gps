/** Ordered stop data and actor/tenant identifiers are validated before persistence. */
export interface PlannedStop {
  readonly id: string;
  readonly sequence: number;
  readonly addressLine: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly orderIds: readonly string[];
}

export interface PlannedRoute {
  readonly id: string;
  readonly organizationId: string;
  readonly publicCode: string;
  readonly plannedDate: string;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly status: 'planned' | 'in_progress';
  readonly stops: readonly PlannedStop[];
  readonly createdAt: string;
}

/** One atomic decision: route, links, and audited transitions commit together. */
export interface RoutePlanningStore {
  plan(route: PlannedRoute, actorUserId: string): Promise<PlannedRoute>;
  findById(organizationId: string, routeId: string): Promise<PlannedRoute | null>;
  /** Replace resources without touching stops, orders or their history. */
  reassign(organizationId: string, routeId: string, changes: {
    readonly driverId?: string;
    readonly vehicleId?: string;
  }): Promise<PlannedRoute>;
}
