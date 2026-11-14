import { randomUUID } from 'node:crypto';
import { In, type DataSource, type EntityManager } from 'typeorm';

import type {
  PlannedRoute, PlannedStop, RoutePlanDraft, RoutePlanningStore,
} from '../../modules/delivery-routes/application/ports/RoutePlanningStore.js';
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
import { startRouteInTransaction } from './route-start.js';

/** Process-level unit of work; no module repository calls another module's repository. */
export class RoutePlanningTypeOrmStore implements RoutePlanningStore {
  constructor(private readonly dataSource: DataSource) {}

  async plan(route: RoutePlanDraft, actorUserId: string): Promise<PlannedRoute> {
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
        const simulated = route.simulatedCompletionEnabled === true;
        // The driver row lock above serializes this check with account binding.
        if (simulated && await driverHasAccount(manager, route.organizationId, route.driverId)) {
          throw new DeliveryRouteConflictError('Simulated routes require a driver without a linked account');
        }

        const allIds = route.stops.map((stop) => stop.orderId);
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
        // Each stop is a snapshot of its locked order's location, so a concurrent
        // order edit cannot slip in between reading and planning.
        const stops: PlannedStop[] = route.stops.map((stop) => {
          const order = orders.get(stop.orderId);
          if (order === undefined) throw new DeliveryRouteNotFoundError();
          if (order.latitude === null || order.longitude === null) {
            throw new DeliveryRouteConflictError('Every planned order must have delivery coordinates');
          }
          return { id: stop.id, sequence: stop.sequence, addressLine: order.deliveryAddressLine,
            latitude: Number(order.latitude), longitude: Number(order.longitude), orderIds: [stop.orderId] };
        });
        const planned: PlannedRoute = { ...route, stops };

        const plannedAt = route.createdAt;
        const assignedAt = new Date(Date.parse(plannedAt) + 1).toISOString();
        const assignedOrders = [];
        for (const id of allIds) {
          const order = orders.get(id);
          if (order === undefined) throw new DeliveryRouteNotFoundError();
          const packages = await manager.find(DeliveryOrderPackageEntity, {
            where: { deliveryOrderId: id },
          });
          assignedOrders.push({ id, original: order,
            ...toDomain(order, packages).planAndAssign(route.id, plannedAt, assignedAt) });
        }

        // Retain the previous link as route history, but release its active
        // order reservation before the unique active-link index sees the retry.
        for (const { id, original } of assignedOrders) {
          if (original.status !== 'returned') continue;
          if (original.activeRouteId === null) {
            throw new DeliveryRouteConflictError('Returned order must reference its prior route');
          }
          const released = await manager.update(DeliveryStopOrderEntity, {
            organizationId: route.organizationId, orderId: id,
            routeId: original.activeRouteId, active: true,
          }, { active: false });
          if (released.affected !== 1) {
            throw new DeliveryRouteConflictError('Returned order must have exactly one active prior route link');
          }
        }

        const persistedRoute = new DeliveryRouteEntity();
        persistedRoute.id = route.id;
        persistedRoute.organizationId = route.organizationId;
        persistedRoute.publicCode = route.publicCode;
        persistedRoute.plannedDate = route.plannedDate;
        persistedRoute.driverId = route.driverId;
        persistedRoute.vehicleId = route.vehicleId;
        persistedRoute.status = route.status;
        persistedRoute.originAddressLine = route.origin?.addressLine ?? null;
        persistedRoute.originLatitude = route.origin === undefined ? null : String(route.origin.latitude);
        persistedRoute.originLongitude = route.origin === undefined ? null : String(route.origin.longitude);
        persistedRoute.simulatedCompletionEnabled = route.simulatedCompletionEnabled ?? false;
        persistedRoute.simulationActorUserId = simulated ? actorUserId : null;
        persistedRoute.createdAt = new Date(route.createdAt);
        persistedRoute.startedAt = null;
        persistedRoute.completedAt = null;
        await manager.insert(DeliveryRouteEntity, persistedRoute);

        for (const stop of stops) {
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

        for (const { id, original, planned, assigned } of assignedOrders) {
          await manager.update(DeliveryOrderEntity, { id, organizationId: route.organizationId }, {
            status: assigned.status, updatedAt: new Date(assigned.updatedAt), activeRouteId: route.id,
          });
          for (const [fromStatus, toStatus, occurredAt] of [
            [original.status, planned.status, planned.updatedAt],
            [planned.status, assigned.status, assigned.updatedAt],
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
        if (!simulated) return planned;
        // Simulated routes have no driver account to start them, so they start now.
        const startedAt = await startRouteInTransaction(manager, persistedRoute, actorUserId, assignedAt);
        return { ...planned, status: 'in_progress' as const, startedAt: startedAt.toISOString() };
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

  async listSimulationEligibleDriverIds(organizationId: string): Promise<readonly string[]> {
    const rows = await this.dataSource.query<{ id: string }[]>(`
      SELECT d.id FROM drivers d
      WHERE d.organization_id=$1 AND d.status='active'
        AND NOT EXISTS (SELECT 1 FROM driver_accounts a
          WHERE a.organization_id=d.organization_id AND a.driver_id=d.id)
      ORDER BY d.full_name, d.id`, [organizationId]);
    return rows.map((row) => row.id);
  }

  async list(organizationId: string): Promise<readonly PlannedRoute[]> {
    const routes = await this.dataSource.manager.find(DeliveryRouteEntity, {
      where: { organizationId, status: In(['planned', 'in_progress', 'completed']) },
      order: { plannedDate: 'ASC', createdAt: 'ASC' },
    });
    const result: PlannedRoute[] = [];
    for (const route of routes) {
      const planned = await this.readPlannedRoute(this.dataSource.manager, organizationId, route.id);
      if (planned !== null) result.push(planned);
    }
    return result;
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
    if (route.status !== 'planned' && route.status !== 'in_progress' && route.status !== 'completed') {
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
      driverId: route.driverId, vehicleId: route.vehicleId,
      ...(route.originAddressLine === null || route.originLatitude === null || route.originLongitude === null
        ? {} : { origin: { addressLine: route.originAddressLine,
          latitude: Number(route.originLatitude), longitude: Number(route.originLongitude) } }),
      ...(route.simulatedCompletionEnabled ? { simulatedCompletionEnabled: true } : {}),
      status: route.status as PlannedRoute['status'],
      createdAt: route.createdAt.toISOString(),
      ...(route.startedAt === null ? {} : { startedAt: route.startedAt.toISOString() }),
      ...(route.completedAt === null ? {} : { completedAt: route.completedAt.toISOString() }),
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

async function driverHasAccount(manager: EntityManager, organizationId: string,
  driverId: string): Promise<boolean> {
  const rows = await manager.query<unknown[]>(
    'SELECT 1 FROM driver_accounts WHERE organization_id=$1 AND driver_id=$2', [organizationId, driverId]);
  return rows.length > 0;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('driverError' in error)) return false;
  const driverError = error.driverError;
  return typeof driverError === 'object' && driverError !== null &&
    'code' in driverError && driverError.code === '23505';
}
