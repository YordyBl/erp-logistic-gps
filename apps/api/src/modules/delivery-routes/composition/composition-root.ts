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
import { PlanRouteUseCase } from '../application/use-cases/plan-route/PlanRouteUseCase.js';
import { GetRouteUseCase } from '../application/use-cases/get-route/GetRouteUseCase.js';
import { ReassignRouteUseCase } from '../application/use-cases/reassign-route/ReassignRouteUseCase.js';
import { ListRoutesUseCase } from '../application/use-cases/list-routes/ListRoutesUseCase.js';
import type { PlannedRoute, RoutePlanningStore } from '../application/ports/RoutePlanningStore.js';
import type { MapLinkResolver } from '../application/ports/MapLinkResolver.js';
import { GoogleMapsLinkResolver } from '../infrastructure/GoogleMapsLinkResolver.js';

/** In-memory adapter for tests and demo; production uses the database transaction adapter. */
export class InMemoryRoutePlanningStore implements RoutePlanningStore, DriverRouteExecutionStore {
  private readonly routes = new Map<string, PlannedRoute & { readonly startedAt?: string }>();

  constructor(private readonly orders: InMemoryDeliveryOrderRepository,
    private readonly bindings?: DriverAccountBindingStore,
    private readonly users?: UserRepository,
    private readonly getDriver?: GetDriverUseCase) {}

  async plan(route: PlannedRoute, actorUserId: string): Promise<PlannedRoute> {
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

  async list(organizationId: string): Promise<readonly PlannedRoute[]> {
    return [...this.routes.values()]
      .filter((route) => route.organizationId === organizationId)
      .filter((route) => route.status === 'planned' || route.status === 'in_progress' || route.status === 'completed')
      .sort((left, right) => left.plannedDate.localeCompare(right.plannedDate) ||
        left.createdAt.localeCompare(right.createdAt));
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
    getRoute: new GetRouteUseCase(options.store),
    reassignRoute: new ReassignRouteUseCase(options.store, options.getDriver, options.getVehicle),
    executeDriverRoute: new ExecuteDriverRouteUseCase(options.executionStore, clock, simulation),
  };
}

export type DeliveryRoutesModule = ReturnType<typeof createDeliveryRoutesModule>;
