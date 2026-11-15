import { SystemClock, type Clock } from '../../../shared/clock.js';
import type { GetDriverUseCase } from '../../drivers/application/use-cases/get-driver/GetDriverUseCase.js';
import type { GetVehicleUseCase } from '../../vehicles/application/use-cases/get-vehicle/GetVehicleUseCase.js';
import type { InMemoryDeliveryOrderRepository } from '../../delivery-orders/composition/composition-root.js';
import { toDeliveryOrderDto } from '../../delivery-orders/application/dto/DeliveryOrderDto.js';
import type { DriverAccountBindingStore } from '../../drivers/application/ports/DriverAccountBindingStore.js';
import type { UserRepository } from '../../identity-and-access/application/ports/UserRepository.js';
import type { DriverRouteExecutionStore, DriverRouteView } from '../application/ports/DriverRouteExecutionStore.js';
import { ExecuteDriverRouteUseCase } from '../application/use-cases/execute-driver-route/ExecuteDriverRouteUseCase.js';
import { DeliveryRouteConflictError, DeliveryRouteNotFoundError } from '../domain/errors/DeliveryRouteError.js';
import { GetRouteSimulationUseCase } from '../application/use-cases/get-route-simulation/GetRouteSimulationUseCase.js';
import { PlanRouteUseCase } from '../application/use-cases/plan-route/PlanRouteUseCase.js';
import { GetRouteUseCase } from '../application/use-cases/get-route/GetRouteUseCase.js';
import { ReassignRouteUseCase } from '../application/use-cases/reassign-route/ReassignRouteUseCase.js';
import { ListRoutesUseCase } from '../application/use-cases/list-routes/ListRoutesUseCase.js';
import { ListRoutesPageUseCase } from '../application/use-cases/list-routes/ListRoutesPageUseCase.js';
import {
  ROUTE_STATUSES,
  type PlannedRoute, type PlannedStop, type RoutePageCriteria, type RoutePlanDraft, type RoutePlanningStore,
  type RouteSortField,
} from '../application/ports/RoutePlanningStore.js';
import { pageOffset, type PageResult } from '../../../http/pagination.js';
import type { MapLinkResolver } from '../application/ports/MapLinkResolver.js';
import { GoogleMapsLinkResolver } from '../infrastructure/GoogleMapsLinkResolver.js';

/** In-memory adapter for tests and demo; production uses the database transaction adapter. */
export class InMemoryRoutePlanningStore implements RoutePlanningStore, DriverRouteExecutionStore {
  private readonly routes = new Map<string, PlannedRoute & { readonly startedAt?: string }>();
  private nextRouteNumber = 1;

  constructor(private readonly orders: InMemoryDeliveryOrderRepository,
    private readonly bindings?: DriverAccountBindingStore,
    private readonly users?: UserRepository,
    private readonly getDriver?: Pick<GetDriverUseCase, 'execute'>,
    /** Resolves plates for the `q` search; without it only codes and driver names match. */
    private readonly getVehicle?: Pick<GetVehicleUseCase, 'execute'>) {}

  async nextPublicCode(): Promise<string> {
    return `RUT-${String(this.nextRouteNumber++).padStart(8, '0')}`;
  }

  async plan(draft: RoutePlanDraft, actorUserId: string): Promise<PlannedRoute> {
    // Mirror the database adapter: every stop copies its single order's location.
    const stops: PlannedStop[] = [];
    for (const stop of draft.stops) {
      const order = await this.orders.findById(stop.orderId);
      if (order === null || order.organizationId !== draft.organizationId) throw new DeliveryRouteNotFoundError();
      const { addressLine, latitude, longitude } = order.deliveryAddress;
      if (latitude === undefined || longitude === undefined) {
        throw new DeliveryRouteConflictError('Every planned order must have delivery coordinates');
      }
      stops.push({ id: stop.id, sequence: stop.sequence, addressLine, latitude, longitude, orderIds: [stop.orderId] });
    }
    const route: PlannedRoute = { ...draft, stops };
    for (const current of this.routes.values()) {
      if (current.organizationId === route.organizationId &&
          (current.publicCode === route.publicCode || current.driverId === route.driverId ||
            current.vehicleId === route.vehicleId)) {
        throw new DeliveryRouteConflictError('Route code, driver or vehicle already has an active assignment');
      }
    }
    const plannedAt = route.createdAt;
    const assignedAt = new Date(Date.parse(plannedAt) + 1).toISOString();
    this.orders.planAndAssign(route.organizationId, route.id,
      route.stops.flatMap((stop) => stop.orderIds), actorUserId, plannedAt, assignedAt);
    this.routes.set(route.id, route);
    return route;
  }

  async findById(organizationId: string, routeId: string): Promise<PlannedRoute | null> {
    const route = this.routes.get(routeId);
    return route?.organizationId === organizationId ? route : null;
  }

  /** The in-memory planner holds no account bindings, so it offers no simulation drivers. */
  async listSimulationEligibleDriverIds(): Promise<readonly string[]> {
    return [];
  }

  async list(organizationId: string): Promise<readonly PlannedRoute[]> {
    return [...this.routes.values()]
      .filter((route) => route.organizationId === organizationId)
      .filter((route) => route.status === 'planned' || route.status === 'in_progress' || route.status === 'completed')
      .sort((left, right) => left.plannedDate.localeCompare(right.plannedDate) ||
        left.createdAt.localeCompare(right.createdAt));
  }

  /** Same filters, facet counts, order and slicing as the PostgreSQL adapter. */
  async listPage(organizationId: string, criteria: RoutePageCriteria): Promise<PageResult<PlannedRoute>> {
    const tenantRoutes = await this.list(organizationId);
    const needle = criteria.q?.toLocaleLowerCase();
    const searchable = new Map<string, string[]>();
    if (needle !== undefined) {
      for (const route of tenantRoutes) {
        searchable.set(route.id, [route.publicCode,
          await this.resourceName(() => this.getDriver?.execute({ organizationId, driverId: route.driverId })
            .then((result) => result.driver.fullName)),
          await this.resourceName(() => this.getVehicle?.execute({ organizationId, vehicleId: route.vehicleId })
            .then((result) => result.vehicle.plate)),
        ].filter((value): value is string => value !== undefined));
      }
    }
    const matching = (omitStatus = false) => tenantRoutes.filter((route) => {
      if (!omitStatus && criteria.status !== undefined && !criteria.status.includes(route.status)) return false;
      if (criteria.ids !== undefined && !criteria.ids.includes(route.id)) return false;
      if (criteria.driverId !== undefined && route.driverId !== criteria.driverId) return false;
      if (criteria.vehicleId !== undefined && route.vehicleId !== criteria.vehicleId) return false;
      const day = route.plannedDate.slice(0, 10);
      if (criteria.plannedFrom !== undefined && day < criteria.plannedFrom) return false;
      if (criteria.plannedTo !== undefined && day > criteria.plannedTo) return false;
      if (needle === undefined) return true;
      return (searchable.get(route.id) ?? []).some((value) => value.toLocaleLowerCase().includes(needle));
    });

    const status = Object.fromEntries(ROUTE_STATUSES.map((value) => [value, 0])) as Record<string, number>;
    for (const route of matching(true)) status[route.status] = (status[route.status] ?? 0) + 1;

    const filtered = matching();
    const sign = criteria.sort.direction === 'asc' ? 1 : -1;
    const sorted = [...filtered].sort((left, right) => sign * (
      compareText(routeSortValue(left, criteria.sort.field), routeSortValue(right, criteria.sort.field))
      || compareText(left.createdAt, right.createdAt)
      || compareText(left.id, right.id)
    ));
    const offset = pageOffset(criteria);
    return { items: sorted.slice(offset, offset + criteria.pageSize), total: filtered.length, counts: { status } };
  }

  /** A missing lookup or an unknown resource simply does not match the search. */
  private async resourceName(read: () => Promise<string> | undefined): Promise<string | undefined> {
    try {
      return await read();
    } catch {
      return undefined;
    }
  }

  async reassign(organizationId: string, routeId: string, changes: {
    readonly driverId?: string;
    readonly vehicleId?: string;
  }): Promise<PlannedRoute> {
    const route = this.routes.get(routeId);
    if (route === undefined || route.organizationId !== organizationId) {
      throw new DeliveryRouteNotFoundError();
    }
    if (route.status !== 'planned') {
      throw new DeliveryRouteConflictError('Only planned routes accept reassignment');
    }
    const driverId = changes.driverId ?? route.driverId;
    const vehicleId = changes.vehicleId ?? route.vehicleId;
    for (const current of this.routes.values()) {
      if (current.id === routeId) continue;
      if (current.organizationId === organizationId &&
          (current.driverId === driverId || current.vehicleId === vehicleId)) {
        throw new DeliveryRouteConflictError('Driver or vehicle already has an active assignment');
      }
    }
    const updated = { ...route, driverId, vehicleId };
    this.routes.set(routeId, updated);
    return updated;
  }

  private async authorizedDriver(organizationId: string, actorUserId: string): Promise<string> {
    const user = await this.users?.findById(actorUserId);
    if (user === null || user === undefined || user.organizationId !== organizationId ||
        user.role !== 'DRIVER' || user.status !== 'active') throw new DeliveryRouteNotFoundError();
    const driverId = await this.bindings?.findDriverId(organizationId, actorUserId);
    if (driverId === null || driverId === undefined) throw new DeliveryRouteNotFoundError();
    const driver = await this.getDriver?.execute({ organizationId, driverId });
    if (driver?.driver.status !== 'active') throw new DeliveryRouteNotFoundError();
    return driverId;
  }

  private async view(route: PlannedRoute & { readonly startedAt?: string }): Promise<DriverRouteView> {
    const stops = await Promise.all(route.stops.map(async ({ orderIds, ...stop }) => ({
      ...stop, orders: await Promise.all(orderIds.map(async (id) => {
        const order = await this.orders.findById(id);
        if (order === null || order.organizationId !== route.organizationId ||
            order.activeRouteId !== route.id) throw new DeliveryRouteConflictError('Route order is invalid');
        return toDeliveryOrderDto(order);
      })),
    })));
    return { id: route.id, publicCode: route.publicCode, plannedDate: route.plannedDate,
      driverId: route.driverId, vehicleId: route.vehicleId, status: route.status,
      startedAt: route.startedAt ?? null, completedAt: null, stops };
  }

  async mine(organizationId: string, actorUserId: string): Promise<DriverRouteView> {
    const driverId = await this.authorizedDriver(organizationId, actorUserId);
    const route = [...this.routes.values()].find((item) => item.organizationId === organizationId &&
      item.driverId === driverId && ['planned', 'in_progress'].includes(item.status));
    if (route === undefined) throw new DeliveryRouteNotFoundError();
    return this.view(route);
  }

  async start(organizationId: string, routeId: string, actorUserId: string,
    occurredAt: string): Promise<DriverRouteView> {
    const route = this.routes.get(routeId);
    if (route === undefined || route.organizationId !== organizationId) throw new DeliveryRouteNotFoundError();
    const driverId = await this.authorizedDriver(organizationId, actorUserId);
    if (route.driverId !== driverId) throw new DeliveryRouteNotFoundError();
    if (route.status !== 'planned') throw new DeliveryRouteConflictError('Only planned routes can start');
    const ids = route.stops.flatMap((stop) => stop.orderIds);
    if (ids.length === 0 || new Set(ids).size !== ids.length) {
      throw new DeliveryRouteConflictError('Route must contain unique orders');
    }
    const timestamp = new Date(Math.max(Date.parse(occurredAt), Date.parse(route.createdAt) + 1))
      .toISOString();
    this.orders.startRoute(organizationId, routeId, ids, actorUserId, timestamp);
    const started = { ...route, status: 'in_progress' as const, startedAt: timestamp };
    this.routes.set(routeId, started);
    return this.view(started);
  }
}

function routeSortValue(route: PlannedRoute, field: RouteSortField): string {
  switch (field) {
    case 'publicCode': return route.publicCode;
    case 'plannedDate': return route.plannedDate.slice(0, 10);
    case 'status': return route.status;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createDeliveryRoutesModule(options: {
  readonly store: RoutePlanningStore;
  readonly getDriver: GetDriverUseCase;
  readonly getVehicle: GetVehicleUseCase;
  readonly executionStore: DriverRouteExecutionStore;
  readonly clock?: Clock;
  readonly mapLinkResolver?: MapLinkResolver;
  /** Route simulation; the process enables it only in an explicit development environment. */
  readonly simulationEnabled?: boolean;
}) {
  const clock = options.clock ?? new SystemClock();
  const simulation = { simulationEnabled: options.simulationEnabled ?? false };
  return {
    planRoute: new PlanRouteUseCase(options.store, options.getDriver,
      options.getVehicle, clock, options.mapLinkResolver ?? new GoogleMapsLinkResolver(), simulation),
    listRoutes: new ListRoutesUseCase(options.store),
    listRoutesPage: new ListRoutesPageUseCase(options.store),
    getRoute: new GetRouteUseCase(options.store),
    getRouteSimulation: new GetRouteSimulationUseCase(options.store, simulation),
    reassignRoute: new ReassignRouteUseCase(options.store, options.getDriver, options.getVehicle),
    executeDriverRoute: new ExecuteDriverRouteUseCase(options.executionStore, clock, simulation),
  };
}

export type DeliveryRoutesModule = ReturnType<typeof createDeliveryRoutesModule>;
