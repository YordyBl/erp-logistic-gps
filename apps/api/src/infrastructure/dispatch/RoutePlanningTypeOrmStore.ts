import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';

import type { PlannedRoute, RoutePlanningStore } from '../../modules/delivery-routes/application/ports/RoutePlanningStore.js';
import { DeliveryRouteConflictError, DeliveryRouteNotFoundError } from '../../modules/delivery-routes/domain/errors/DeliveryRouteError.js';
import { DeliveryRouteEntity } from '../../modules/delivery-routes/infrastructure/persistence/entities/DeliveryRouteEntity.js';
import { DeliveryStopEntity } from '../../modules/delivery-routes/infrastructure/persistence/entities/DeliveryStopEntity.js';
import { DeliveryStopOrderEntity } from '../../modules/delivery-routes/infrastructure/persistence/entities/DeliveryStopOrderEntity.js';
import { DeliveryOrderEntity } from '../../modules/delivery-orders/infrastructure/persistence/entities/DeliveryOrderEntity.js';
import { DeliveryOrderPackageEntity } from '../../modules/delivery-orders/infrastructure/persistence/entities/DeliveryOrderPackageEntity.js';
import { DeliveryOrderStatusHistoryEntity } from '../../modules/delivery-orders/infrastructure/persistence/entities/DeliveryOrderStatusHistoryEntity.js';
import { toDomain } from '../../modules/delivery-orders/infrastructure/persistence/mappers/DeliveryOrderMapper.js';
import { DriverEntity } from '../../modules/drivers/infrastructure/persistence/entities/DriverEntity.js';
import { VehicleEntity } from '../../modules/vehicles/infrastructure/persistence/entities/VehicleEntity.js';

/** Process-level unit of work; no module repository calls another module's repository. */
export class RoutePlanningTypeOrmStore implements RoutePlanningStore {
  constructor(private readonly dataSource: DataSource) {}

  async plan(route: PlannedRoute, actorUserId: string): Promise<PlannedRoute> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const driver = await manager.findOne(DriverEntity, {
          where: { id: route.driverId, organizationId: route.organizationId },
          lock: { mode: 'pessimistic_read' },
        });
        const vehicle = await manager.findOne(VehicleEntity, {
          where: { id: route.vehicleId, organizationId: route.organizationId },
          lock: { mode: 'pessimistic_read' },
        });
        if (driver === null || vehicle === null) throw new DeliveryRouteNotFoundError();
        if (driver.status !== 'active' || vehicle.status !== 'active') {
          throw new DeliveryRouteConflictError('Driver and vehicle must be active');
        }

        const allIds = route.stops.flatMap((stop) => stop.orderIds);
        const orders = new Map<string, DeliveryOrderEntity>();
        // Consistent lock order prevents crossed multi-order plans from deadlocking.
        for (const id of [...allIds].sort()) {
          const entity = await manager.findOne(DeliveryOrderEntity, {
            where: { id, organizationId: route.organizationId },
            lock: { mode: 'pessimistic_write' },
          });
          if (entity === null) throw new DeliveryRouteNotFoundError();
          orders.set(id, entity);
        }

        const plannedAt = route.createdAt;
        const assignedAt = new Date(Date.parse(plannedAt) + 1).toISOString();
        const assignedOrders = [];
        for (const id of allIds) {
          const order = orders.get(id);
          if (order === undefined) throw new DeliveryRouteNotFoundError();
          const packages = await manager.find(DeliveryOrderPackageEntity, {
            where: { deliveryOrderId: id },
          });
          assignedOrders.push({ id, ...toDomain(order, packages).planAndAssign(route.id, plannedAt, assignedAt) });
        }

        const persistedRoute = new DeliveryRouteEntity();
        persistedRoute.id = route.id;
        persistedRoute.organizationId = route.organizationId;
        persistedRoute.publicCode = route.publicCode;
        persistedRoute.plannedDate = route.plannedDate;
        persistedRoute.driverId = route.driverId;
        persistedRoute.vehicleId = route.vehicleId;
        persistedRoute.status = route.status;
        persistedRoute.createdAt = new Date(route.createdAt);
        persistedRoute.startedAt = null;
        persistedRoute.completedAt = null;
        await manager.insert(DeliveryRouteEntity, persistedRoute);

        for (const stop of route.stops) {
          const row = new DeliveryStopEntity();
          row.id = stop.id;
          row.organizationId = route.organizationId;
          row.routeId = route.id;
          row.sequence = stop.sequence;
          row.addressLine = stop.addressLine;
          row.latitude = stop.latitude === null ? null : String(stop.latitude);
          row.longitude = stop.longitude === null ? null : String(stop.longitude);
          row.status = 'pending';
          row.plannedArrivalAt = null;
          await manager.insert(DeliveryStopEntity, row);
          for (const [position, orderId] of stop.orderIds.entries()) {
            const link = new DeliveryStopOrderEntity();
            link.id = randomUUID();
            link.organizationId = route.organizationId;
            link.routeId = route.id;
            link.stopId = stop.id;
            link.orderId = orderId;
            link.position = position;
            link.active = true;
            link.createdAt = new Date(route.createdAt);
            await manager.insert(DeliveryStopOrderEntity, link);
          }
        }

        for (const { id, planned, assigned } of assignedOrders) {
          await manager.update(DeliveryOrderEntity, { id, organizationId: route.organizationId }, {
            status: assigned.status, updatedAt: new Date(assignedAt), activeRouteId: route.id,
          });
          for (const [fromStatus, toStatus, occurredAt] of [
            ['created', planned.status, plannedAt],
            [planned.status, assigned.status, assignedAt],
          ] as const) {
            const history = new DeliveryOrderStatusHistoryEntity();
            history.id = randomUUID();
            history.orderId = id;
            history.organizationId = route.organizationId;
            history.fromStatus = fromStatus;
            history.toStatus = toStatus;
            history.actorUserId = actorUserId;
            history.occurredAt = new Date(occurredAt);
            await manager.insert(DeliveryOrderStatusHistoryEntity, history);
          }
        }
        return route;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DeliveryRouteConflictError('Route code, order, driver or vehicle already has an active assignment');
      }
      throw error;
    }
  }

  async findById(organizationId: string, routeId: string): Promise<PlannedRoute | null> {
    return this.readPlannedRoute(this.dataSource.manager, organizationId, routeId);
  }

  /**
   * Reads one planned route through the given manager. Transactional writers
   * must pass their transaction manager: a separate pooled connection cannot
   * observe the transaction's uncommitted writes.
   */
  private async readPlannedRoute(
    manager: EntityManager, organizationId: string, routeId: string,
  ): Promise<PlannedRoute | null> {
    const route = await manager.findOne(DeliveryRouteEntity, {
      where: { id: routeId, organizationId },
    });
    if (route === null) return null;
    if (route.status !== 'planned') {
      throw new DeliveryRouteConflictError('Persisted route status is not supported by this planner');
    }
    const stops = await manager.find(DeliveryStopEntity, {
      where: { organizationId, routeId }, order: { sequence: 'ASC' },
    });
    const links = await manager.find(DeliveryStopOrderEntity, {
      where: { organizationId, routeId }, order: { position: 'ASC' },
    });
    return {
      id: route.id, organizationId: route.organizationId,
      publicCode: route.publicCode, plannedDate: route.plannedDate,
      driverId: route.driverId, vehicleId: route.vehicleId, status: 'planned',
      createdAt: route.createdAt.toISOString(),
      stops: stops.map((stop) => ({
        id: stop.id, sequence: stop.sequence, addressLine: stop.addressLine,
        latitude: stop.latitude === null ? null : Number(stop.latitude),
        longitude: stop.longitude === null ? null : Number(stop.longitude),
        orderIds: links.filter((link) => link.stopId === stop.id).map((link) => link.orderId),
      })),
    };
  }

  async reassign(organizationId: string, routeId: string, changes: {
    readonly driverId?: string;
    readonly vehicleId?: string;
  }): Promise<PlannedRoute> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const route = await manager.findOne(DeliveryRouteEntity, {
          where: { id: routeId, organizationId }, lock: { mode: 'pessimistic_write' },
        });
        if (route === null) throw new DeliveryRouteNotFoundError();
        if (route.status !== 'planned') {
          throw new DeliveryRouteConflictError('Only planned routes accept reassignment');
        }
        const driverId = changes.driverId ?? route.driverId;
        const vehicleId = changes.vehicleId ?? route.vehicleId;
        if (changes.driverId !== undefined && changes.driverId !== route.driverId) {
          const driver = await manager.findOne(DriverEntity, {
            where: { id: changes.driverId, organizationId }, lock: { mode: 'pessimistic_read' },
          });
          if (driver === null) throw new DeliveryRouteNotFoundError();
          if (driver.status !== 'active') throw new DeliveryRouteConflictError('Driver must be active');
        }
        if (changes.vehicleId !== undefined && changes.vehicleId !== route.vehicleId) {
          const vehicle = await manager.findOne(VehicleEntity, {
            where: { id: changes.vehicleId, organizationId }, lock: { mode: 'pessimistic_read' },
          });
          if (vehicle === null) throw new DeliveryRouteNotFoundError();
          if (vehicle.status !== 'active') throw new DeliveryRouteConflictError('Vehicle must be active');
        }
        await manager.update(DeliveryRouteEntity, { id: routeId, organizationId }, {
          driverId, vehicleId,
        });
        const updated = await this.readPlannedRoute(manager, organizationId, routeId);
        if (updated === null) throw new DeliveryRouteNotFoundError();
        return updated;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DeliveryRouteConflictError('Driver or vehicle already has an active assignment');
      }
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('driverError' in error)) return false;
  const driverError = error.driverError;
  return typeof driverError === 'object' && driverError !== null &&
    'code' in driverError && driverError.code === '23505';
}
