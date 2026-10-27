import { SystemClock, type Clock } from '../../../shared/clock.js';
import type { GetDriverUseCase } from '../../drivers/application/use-cases/get-driver/GetDriverUseCase.js';
import type { GetVehicleUseCase } from '../../vehicles/application/use-cases/get-vehicle/GetVehicleUseCase.js';
import type { InMemoryDeliveryOrderRepository } from '../../delivery-orders/composition/composition-root.js';
import { DeliveryRouteConflictError, DeliveryRouteNotFoundError } from '../domain/errors/DeliveryRouteError.js';
import { PlanRouteUseCase } from '../application/use-cases/plan-route/PlanRouteUseCase.js';
import { GetRouteUseCase } from '../application/use-cases/get-route/GetRouteUseCase.js';
import { ReassignRouteUseCase } from '../application/use-cases/reassign-route/ReassignRouteUseCase.js';
import type { PlannedRoute, RoutePlanningStore } from '../application/ports/RoutePlanningStore.js';

/** In-memory adapter for tests and demo; production uses the database transaction adapter. */
export class InMemoryRoutePlanningStore implements RoutePlanningStore {
  private readonly routes = new Map<string, PlannedRoute>();

  constructor(private readonly orders: InMemoryDeliveryOrderRepository) {}

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

  async reassign(organizationId: string, routeId: string, changes: {
    readonly driverId?: string;
    readonly vehicleId?: string;
  }): Promise<PlannedRoute> {
    const route = this.routes.get(routeId);
    if (route === undefined || route.organizationId !== organizationId) {
      throw new DeliveryRouteNotFoundError();
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
}

export function createDeliveryRoutesModule(options: {
  readonly store: RoutePlanningStore;
  readonly getDriver: GetDriverUseCase;
  readonly getVehicle: GetVehicleUseCase;
  readonly clock?: Clock;
}) {
  return {
    planRoute: new PlanRouteUseCase(options.store, options.getDriver,
      options.getVehicle, options.clock ?? new SystemClock()),
    getRoute: new GetRouteUseCase(options.store),
    reassignRoute: new ReassignRouteUseCase(options.store, options.getDriver, options.getVehicle),
  };
}

export type DeliveryRoutesModule = ReturnType<typeof createDeliveryRoutesModule>;
