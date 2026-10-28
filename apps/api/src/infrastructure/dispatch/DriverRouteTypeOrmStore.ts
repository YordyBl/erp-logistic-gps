import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';

import type { DriverRouteExecutionStore, DriverRouteView } from '../../modules/delivery-routes/application/ports/DriverRouteExecutionStore.js';
import { DeliveryRouteConflictError, DeliveryRouteNotFoundError } from '../../modules/delivery-routes/domain/errors/DeliveryRouteError.js';
import { DeliveryRouteEntity } from '../../modules/delivery-routes/infrastructure/persistence/entities/DeliveryRouteEntity.js';
import { DeliveryStopEntity } from '../../modules/delivery-routes/infrastructure/persistence/entities/DeliveryStopEntity.js';
import { DeliveryStopOrderEntity } from '../../modules/delivery-routes/infrastructure/persistence/entities/DeliveryStopOrderEntity.js';
import { DeliveryOrderEntity } from '../../modules/delivery-orders/infrastructure/persistence/entities/DeliveryOrderEntity.js';
import { DeliveryOrderPackageEntity } from '../../modules/delivery-orders/infrastructure/persistence/entities/DeliveryOrderPackageEntity.js';
import { DeliveryOrderStatusHistoryEntity } from '../../modules/delivery-orders/infrastructure/persistence/entities/DeliveryOrderStatusHistoryEntity.js';
import { toDomain } from '../../modules/delivery-orders/infrastructure/persistence/mappers/DeliveryOrderMapper.js';
import { toDeliveryOrderDto } from '../../modules/delivery-orders/application/dto/DeliveryOrderDto.js';
import type { DeliveryOrderDto } from '../../modules/delivery-orders/application/dto/DeliveryOrderDto.js';
import { DriverEntity } from '../../modules/drivers/infrastructure/persistence/entities/DriverEntity.js';
import { UserEntity } from '../../modules/identity-and-access/infrastructure/persistence/entities/UserEntity.js';

/** Process-level transaction joins route, binding and order modules without cross-repository calls. */
export class DriverRouteTypeOrmStore implements DriverRouteExecutionStore {
  constructor(private readonly dataSource: DataSource) {}

  private async requireDriver(manager: EntityManager, organizationId: string,
    driverId: string, actorUserId: string): Promise<void> {
    // Lock the driver after the route: bind/unbind and start cannot cross unnoticed.
    const driver = await manager.findOne(DriverEntity, {
      where: { id: driverId, organizationId }, lock: { mode: 'pessimistic_read' },
    });
    if (driver === null || driver.status !== 'active') throw new DeliveryRouteNotFoundError();
    const user = await manager.findOne(UserEntity, {
      where: { id: actorUserId, organizationId }, lock: { mode: 'pessimistic_read' },
    });
    if (user === null || user.status !== 'active' || user.role !== 'DRIVER') {
      throw new DeliveryRouteNotFoundError();
    }
    const rows = await manager.query<{ driver_id: string }[]>(
      `SELECT driver_id FROM driver_accounts WHERE organization_id=$1 AND user_id=$2 AND driver_id=$3`,
      [organizationId, actorUserId, driverId]);
    if (rows.length !== 1) throw new DeliveryRouteNotFoundError();
  }

  private async view(manager: EntityManager, route: DeliveryRouteEntity): Promise<DriverRouteView> {
    const { organizationId, id: routeId } = route;
    const stops = await manager.find(DeliveryStopEntity, {
      where: { organizationId, routeId }, order: { sequence: 'ASC' },
    });
    const links = await manager.find(DeliveryStopOrderEntity, {
      where: { organizationId, routeId, active: true }, order: { position: 'ASC' },
    });
    const orderIds = links.map((link) => link.orderId);
    if (stops.length === 0 || orderIds.length === 0 || new Set(orderIds).size !== orderIds.length) {
      throw new DeliveryRouteConflictError('Route must contain unique active orders');
    }
    const orders = new Map<string, DeliveryOrderDto>();
    for (const id of [...orderIds].sort()) {
      const order = await manager.findOne(DeliveryOrderEntity, { where: { id, organizationId } });
      if (order === null || order.activeRouteId !== routeId) {
        throw new DeliveryRouteConflictError('Route order is invalid');
      }
      const packages = await manager.find(DeliveryOrderPackageEntity, { where: { deliveryOrderId: id } });
      orders.set(id, toDeliveryOrderDto(toDomain(order, packages)));
    }
    return {
      id: routeId, publicCode: route.publicCode, plannedDate: route.plannedDate,
      driverId: route.driverId, vehicleId: route.vehicleId,
      status: route.status as DriverRouteView['status'],
      startedAt: route.startedAt?.toISOString() ?? null,
      stops: stops.map((stop) => ({
        id: stop.id, sequence: stop.sequence, addressLine: stop.addressLine,
        latitude: stop.latitude === null ? null : Number(stop.latitude),
        longitude: stop.longitude === null ? null : Number(stop.longitude),
        orders: links.filter((link) => link.stopId === stop.id).map((link) => {
          const order = orders.get(link.orderId);
          if (order === undefined) throw new DeliveryRouteConflictError('Route order is invalid');
          return order;
        }),
      })),
    };
  }

  async mine(organizationId: string, actorUserId: string): Promise<DriverRouteView> {
    return this.dataSource.transaction(async (manager) => {
      // The lookup is only a candidate: authorization is checked under locks below.
      const rows = await manager.query<{ driver_id: string }[]>(
        `SELECT driver_id FROM driver_accounts WHERE organization_id=$1 AND user_id=$2`,
        [organizationId, actorUserId]);
      const driverId = rows[0]?.driver_id;
      if (driverId === undefined) throw new DeliveryRouteNotFoundError();
      // If an inconsistent legacy store ever exposes both, never hide the run
      // already in progress behind a later planned assignment.
      const route = await manager.findOne(DeliveryRouteEntity, {
        where: { organizationId, driverId, status: 'in_progress' },
        lock: { mode: 'pessimistic_read' },
      }) ?? await manager.findOne(DeliveryRouteEntity, {
        where: { organizationId, driverId, status: 'planned' },
        lock: { mode: 'pessimistic_read' },
      });
      if (route === null) throw new DeliveryRouteNotFoundError();
      await this.requireDriver(manager, organizationId, route.driverId, actorUserId);
      return this.view(manager, route);
    });
  }

  async start(organizationId: string, routeId: string, actorUserId: string,
    occurredAt: string): Promise<DriverRouteView> {
    return this.dataSource.transaction(async (manager) => {
      const route = await manager.findOne(DeliveryRouteEntity, {
        where: { id: routeId, organizationId }, lock: { mode: 'pessimistic_write' },
      });
      if (route === null) throw new DeliveryRouteNotFoundError();
      await this.requireDriver(manager, organizationId, route.driverId, actorUserId);
      if (route.status !== 'planned') throw new DeliveryRouteConflictError('Only planned routes can start');
      const stops = await manager.find(DeliveryStopEntity, { where: { organizationId, routeId } });
      const links = await manager.find(DeliveryStopOrderEntity, {
        where: { organizationId, routeId, active: true },
      });
      const ids = links.map((link) => link.orderId);
      if (stops.length === 0 || ids.length === 0 || new Set(ids).size !== ids.length ||
          links.some((link) => !stops.some((stop) => stop.id === link.stopId))) {
        throw new DeliveryRouteConflictError('Route must contain unique active orders');
      }
      const originals = [];
      for (const id of [...ids].sort()) {
        const order = await manager.findOne(DeliveryOrderEntity, {
          where: { id, organizationId }, lock: { mode: 'pessimistic_write' },
        });
        if (order === null || order.activeRouteId !== routeId) {
          throw new DeliveryRouteConflictError('Route order is invalid');
        }
        const packages = await manager.find(DeliveryOrderPackageEntity, { where: { deliveryOrderId: id } });
        originals.push({ order, domain: toDomain(order, packages) });
      }
      const timestamp = new Date(Math.max(Date.parse(occurredAt), route.createdAt.getTime() + 1,
        ...originals.map(({ order }) => order.updatedAt.getTime() + 1)));
      const started = originals.map(({ order, domain }) => ({
        order, updated: domain.startTransit(routeId, timestamp.toISOString()),
      }));
      for (const { order, updated } of started) {
        await manager.update(DeliveryOrderEntity, { id: order.id, organizationId }, {
          status: updated.status, updatedAt: timestamp,
        });
        const history = new DeliveryOrderStatusHistoryEntity();
        history.id = randomUUID(); history.orderId = order.id;
        history.organizationId = organizationId; history.fromStatus = order.status;
        history.toStatus = updated.status; history.actorUserId = actorUserId;
        history.occurredAt = timestamp;
        await manager.insert(DeliveryOrderStatusHistoryEntity, history);
      }
      await manager.update(DeliveryRouteEntity, { id: routeId, organizationId }, {
        status: 'in_progress', startedAt: timestamp,
      });
      await manager.query(`INSERT INTO delivery_route_status_history
        (id, organization_id, route_id, from_status, to_status, actor_user_id, occurred_at)
        VALUES ($1,$2,$3,'planned','in_progress',$4,$5)`,
      [randomUUID(), organizationId, routeId, actorUserId, timestamp]);
      route.status = 'in_progress'; route.startedAt = timestamp;
      return this.view(manager, route);
    });
  }
}
