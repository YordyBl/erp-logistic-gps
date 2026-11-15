import type { PageCriteria, PageResult } from '../../../../http/pagination.js';

/** Statuses the planner lists (cancelled routes are never listed). */
export const ROUTE_STATUSES = ['planned', 'in_progress', 'completed'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

/** Fields `listPage` may sort by; `createdAt` then `id`, in the same direction, always break ties. */
export const ROUTE_SORT_FIELDS = ['publicCode', 'plannedDate', 'status'] as const;
export type RouteSortField = (typeof ROUTE_SORT_FIELDS)[number];

/**
 * One page of a tenant's routes. Filters are optional and combine with AND;
 * `q` matches (case-insensitive substring) the route code, the driver's full
 * name and the vehicle plate. `plannedFrom`/`plannedTo` are inclusive
 * `YYYY-MM-DD` dates.
 */
export interface RoutePageCriteria extends PageCriteria<RouteSortField> {
  readonly status?: readonly RouteStatus[];
  readonly ids?: readonly string[];
  readonly driverId?: string;
  readonly vehicleId?: string;
  readonly plannedFrom?: string;
  readonly plannedTo?: string;
}

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
  readonly status: RouteStatus;
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
  /** Reserves the next generated route code (`RUT-00000001`) for a route planned without one. */
  nextPublicCode(): Promise<string>;
  /**
   * Copies each order's delivery address and coordinates into its stop while the
   * order row is locked (a snapshot), and rejects orders without coordinates.
   */
  plan(route: RoutePlanDraft, actorUserId: string): Promise<PlannedRoute>;
  list(organizationId: string): Promise<readonly PlannedRoute[]>;
  /**
   * One page of the tenant's routes (stops loaded for the page only) with the
   * filtered total and `counts.status`, which applies every filter except
   * `status` and lists every status, with 0 when nothing matches.
   */
  listPage(organizationId: string, criteria: RoutePageCriteria): Promise<PageResult<PlannedRoute>>;
  findById(organizationId: string, routeId: string): Promise<PlannedRoute | null>;
  /** Active drivers without a linked account: the only drivers a simulated route may use. */
  listSimulationEligibleDriverIds(organizationId: string): Promise<readonly string[]>;
  /** Replace resources without touching stops, orders or their history. */
  reassign(organizationId: string, routeId: string, changes: {
    readonly driverId?: string;
    readonly vehicleId?: string;
  }): Promise<PlannedRoute>;
}
