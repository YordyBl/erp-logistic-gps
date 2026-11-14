/** Ordered stop data and actor/tenant identifiers are validated before persistence. */
export interface PlannedStop {
  readonly id: string;
  readonly sequence: number;
  readonly addressLine: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly orderIds: readonly string[];
}

export interface PlannedRouteOrigin {
  readonly addressLine: string;
  readonly latitude: number;
  readonly longitude: number;
}

export interface PlannedRoute {
  readonly id: string;
  readonly organizationId: string;
  readonly publicCode: string;
  readonly plannedDate: string;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly origin?: PlannedRouteOrigin;
  readonly simulatedCompletionEnabled?: boolean;
  readonly status: 'planned' | 'in_progress' | 'completed';
  readonly stops: readonly PlannedStop[];
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

/** A stop as the planner requests it: exactly one order, no location of its own. */
export interface PlannedStopDraft {
  readonly id: string;
  readonly sequence: number;
  readonly orderId: string;
}

/** A route to plan; the store derives each stop's address and coordinates from its order. */
export interface RoutePlanDraft extends Omit<PlannedRoute, 'stops'> {
  readonly stops: readonly PlannedStopDraft[];
}

/** One atomic decision: route, links, and audited transitions commit together. */
export interface RoutePlanningStore {
  /**
   * Copies each order's delivery address and coordinates into its stop while the
   * order row is locked (a snapshot), and rejects orders without coordinates.
   */
  plan(route: RoutePlanDraft, actorUserId: string): Promise<PlannedRoute>;
  list(organizationId: string): Promise<readonly PlannedRoute[]>;
  findById(organizationId: string, routeId: string): Promise<PlannedRoute | null>;
  /** Active drivers without a linked account: the only drivers a simulated route may use. */
  listSimulationEligibleDriverIds(organizationId: string): Promise<readonly string[]>;
  /** Replace resources without touching stops, orders or their history. */
  reassign(organizationId: string, routeId: string, changes: {
    readonly driverId?: string;
    readonly vehicleId?: string;
  }): Promise<PlannedRoute>;
}
