import { randomUUID } from 'node:crypto';
import { IsNull, type DataSource, type EntityManager } from 'typeorm';

import type { DriverRouteExecutionStore, DriverRouteView } from '../../modules/delivery-routes/application/ports/DriverRouteExecutionStore.js';
import { DeliveryRouteConflictError, DeliveryRouteNotFoundError } from '../../modules/delivery-routes/domain/errors/DeliveryRouteError.js';
import { DeliveryRouteEntity } from '../../modules/delivery-routes/infrastructure/persistence/entities/DeliveryRouteEntity.js';
import { DeliveryStopEntity } from '../../modules/delivery-routes/infrastructure/persistence/entities/DeliveryStopEntity.js';
import { DeliveryStopOrderEntity } from '../../modules/delivery-routes/infrastructure/persistence/entities/DeliveryStopOrderEntity.js';
import { DeliveryOrderEntity } from '../../modules/delivery-orders/infrastructure/persistence/entities/DeliveryOrderEntity.js';
import { DeliveryOrderPackageEntity } from '../../modules/delivery-orders/infrastructure/persistence/entities/DeliveryOrderPackageEntity.js';
import { DeliveryOrderStatusHistoryEntity } from '../../modules/delivery-orders/infrastructure/persistence/entities/DeliveryOrderStatusHistoryEntity.js';
import { DeliveryAttemptEntity } from '../../modules/delivery-execution/infrastructure/persistence/entities/DeliveryAttemptEntity.js';
import { DeliveryEvidenceEntity } from '../../modules/delivery-execution/infrastructure/persistence/entities/DeliveryEvidenceEntity.js';
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
      completedAt: route.completedAt?.toISOString() ?? null,
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
        const attemptNumber = await manager.count(DeliveryAttemptEntity, {
          where: { organizationId, orderId: order.id },
        }) + 1;
        const attempt = new DeliveryAttemptEntity();
        attempt.id = randomUUID();
        attempt.organizationId = organizationId;
        attempt.orderId = order.id;
        attempt.routeId = routeId;
        attempt.driverId = route.driverId;
        attempt.attemptNumber = attemptNumber;
        attempt.status = 'in_progress';
        attempt.startedAt = timestamp;
        attempt.completedAt = null;
        await manager.insert(DeliveryAttemptEntity, attempt);
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

  async confirmDelivery(organizationId: string, orderId: string, actorUserId: string,
    input: { readonly evidenceIds: readonly string[]; readonly receiverName: string | null;
      readonly notes: string | null }, occurredAt: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const { order, attempt } = await this.lockActiveAttempt(
        manager, organizationId, orderId, actorUserId);
      const selected = await this.lockAvailableEvidence(manager, organizationId, orderId,
        attempt.id, input.evidenceIds);
      if (selected.length !== input.evidenceIds.length) {
        throw new DeliveryRouteConflictError('Delivery requires one or two available photos from this attempt');
      }
      const timestamp = outcomeTimestamp(occurredAt, order.updatedAt, attempt.startedAt);
      await manager.update(DeliveryOrderEntity, { id: orderId, organizationId }, {
        status: 'delivered', updatedAt: timestamp,
      });
      await manager.update(DeliveryAttemptEntity, { id: attempt.id, organizationId }, {
        status: 'delivered', completedAt: timestamp,
        receiverName: input.receiverName, deliveryNotes: input.notes,
      });
      await insertOrderHistory(manager, organizationId, orderId, actorUserId,
        'in_transit', 'delivered', timestamp);
      // The route deliberately remains in progress until explicit completion.
    });
  }

  async reportDeliveryIncident(organizationId: string, orderId: string, actorUserId: string,
    input: { readonly category: string; readonly description: string;
      readonly evidenceIds: readonly string[] }, occurredAt: string): Promise<{ incident: {
        readonly id: string; readonly category: string; readonly description: string;
        readonly occurredAt: string;
      } }> {
    return this.dataSource.transaction(async (manager) => {
      const { order, attempt } = await this.lockActiveAttempt(
        manager, organizationId, orderId, actorUserId);
      const selected = await this.lockAvailableEvidence(manager, organizationId, orderId,
        attempt.id, input.evidenceIds);
      if (selected.length !== input.evidenceIds.length) {
        throw new DeliveryRouteConflictError('An incident requires one or two available photos from this attempt');
      }
      const timestamp = outcomeTimestamp(occurredAt, order.updatedAt, attempt.startedAt);
      const incidentId = randomUUID();
      await manager.query(`INSERT INTO delivery_incidents
        (id, organization_id, order_id, attempt_id, category, description, actor_user_id, occurred_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [incidentId, organizationId, orderId, attempt.id, input.category,
        input.description, actorUserId, timestamp]);
      for (const row of selected) {
        await manager.update(DeliveryEvidenceEntity,
          { id: row.id, organizationId, orderId, attemptId: attempt.id }, { incidentId });
      }
      await manager.update(DeliveryOrderEntity, { id: orderId, organizationId }, {
        status: 'returned', updatedAt: timestamp,
      });
      await manager.update(DeliveryAttemptEntity, { id: attempt.id, organizationId }, {
        status: 'failed', completedAt: timestamp,
      });
      await insertOrderHistory(manager, organizationId, orderId, actorUserId,
        'in_transit', 'returned', timestamp);
      return { incident: { id: incidentId, category: input.category,
        description: input.description, occurredAt: timestamp.toISOString() } };
    });
  }

  async complete(organizationId: string, routeId: string, actorUserId: string,
    occurredAt: string): Promise<DriverRouteView> {
    return this.dataSource.transaction(async (manager) => {
      const route = await manager.findOne(DeliveryRouteEntity, {
        where: { id: routeId, organizationId }, lock: { mode: 'pessimistic_write' },
      });
      if (route === null) throw new DeliveryRouteNotFoundError();
      await this.requireDriver(manager, organizationId, route.driverId, actorUserId);
      if (route.status !== 'in_progress') {
        throw new DeliveryRouteConflictError('Only an in-progress route can be completed');
      }
      const active = await manager.find(DeliveryStopOrderEntity, {
        where: { organizationId, routeId, active: true }, order: { orderId: 'ASC' },
      });
      if (active.length === 0) throw new DeliveryRouteConflictError('Route has no active orders');
      for (const link of active) {
        const order = await manager.findOne(DeliveryOrderEntity, {
          where: { id: link.orderId, organizationId }, lock: { mode: 'pessimistic_write' },
        });
        if (order === null || order.activeRouteId !== routeId ||
            !['delivered', 'returned'].includes(order.status)) {
          throw new DeliveryRouteConflictError('Every active route order must have a terminal outcome');
        }
      }
      const timestamp = new Date(Math.max(Date.parse(occurredAt),
        (route.startedAt?.getTime() ?? route.createdAt.getTime()) + 1));
      await manager.update(DeliveryRouteEntity, { id: routeId, organizationId }, {
        status: 'completed', completedAt: timestamp,
      });
      await manager.query(`INSERT INTO delivery_route_status_history
        (id, organization_id, route_id, from_status, to_status, actor_user_id, occurred_at)
        VALUES ($1,$2,$3,'in_progress','completed',$4,$5)`,
      [randomUUID(), organizationId, routeId, actorUserId, timestamp]);
      route.status = 'completed';
      route.completedAt = timestamp;
      return this.view(manager, route);
    });
  }

  async completeSimulated(organizationId: string, routeId: string, driverId: string,
    actorUserId: string, occurredAt: string): Promise<DriverRouteView> {
    return this.dataSource.transaction(async (manager) => {
      const route = await manager.findOne(DeliveryRouteEntity, {
        where: { id: routeId, organizationId }, lock: { mode: 'pessimistic_write' },
      });
      if (route === null || route.driverId !== driverId) throw new DeliveryRouteNotFoundError();
      await this.requireDriver(manager, organizationId, driverId, actorUserId);
      if (route.status === 'completed') return this.view(manager, route);
      if (route.status !== 'in_progress') {
        throw new DeliveryRouteConflictError('Only an in-progress simulated route can be completed');
      }
      const stops = await manager.find(DeliveryStopEntity, { where: { organizationId, routeId } });
      const links = await manager.find(DeliveryStopOrderEntity, {
        where: { organizationId, routeId, active: true },
      });
      if (stops.length !== 1 || links.length !== 1 || links[0]?.stopId !== stops[0]?.id) {
        throw new DeliveryRouteConflictError('Automatic simulation completion requires one delivery stop and one order');
      }
      const activeLink = links[0];
      if (activeLink === undefined) throw new DeliveryRouteConflictError('Simulated route has no active delivery order');
      const orderId = activeLink.orderId;
      const { order, attempt } = await this.lockActiveAttempt(manager, organizationId, orderId, actorUserId);
      if (order.activeRouteId !== routeId || order.status !== 'in_transit') {
        throw new DeliveryRouteConflictError('Simulated delivery order is not active on this route');
      }
      const timestamp = outcomeTimestamp(occurredAt, order.updatedAt, attempt.startedAt);
      await manager.update(DeliveryOrderEntity, { id: orderId, organizationId }, {
        status: 'delivered', updatedAt: timestamp,
      });
      await manager.update(DeliveryAttemptEntity, { id: attempt.id, organizationId }, {
        status: 'delivered', completedAt: timestamp, receiverName: null,
        deliveryNotes: 'SIMULATED: GPS route reached the delivery destination; no physical confirmation or photo was collected.',
      });
      await insertOrderHistory(manager, organizationId, orderId, actorUserId,
        'in_transit', 'delivered', timestamp);

      const routeCompletedAt = new Date(Math.max(timestamp.getTime(),
        (route.startedAt?.getTime() ?? route.createdAt.getTime()) + 1));
      await manager.update(DeliveryRouteEntity, { id: routeId, organizationId }, {
        status: 'completed', completedAt: routeCompletedAt,
      });
      await manager.query(`INSERT INTO delivery_route_status_history
        (id, organization_id, route_id, from_status, to_status, actor_user_id, occurred_at)
        VALUES ($1,$2,$3,'in_progress','completed',$4,$5)`,
      [randomUUID(), organizationId, routeId, actorUserId, routeCompletedAt]);
      route.status = 'completed';
      route.completedAt = routeCompletedAt;
      return this.view(manager, route);
    });
  }

  private async lockActiveAttempt(manager: EntityManager, organizationId: string,
    orderId: string, actorUserId: string) {
    const candidates = await manager.query<{ routeId: string; driverId: string }[]>(`
      SELECT r.id AS "routeId", r.driver_id AS "driverId"
      FROM delivery_orders o
      JOIN delivery_routes r ON r.organization_id=o.organization_id AND r.id=o.active_route_id
      JOIN delivery_attempts a ON a.organization_id=o.organization_id AND a.order_id=o.id
        AND a.route_id=r.id AND a.status='in_progress'
      WHERE o.organization_id=$1 AND o.id=$2 AND o.status='in_transit'
        AND r.status='in_progress'
      FOR UPDATE OF o, r, a`, [organizationId, orderId]);
    const candidate = candidates[0];
    if (candidate === undefined) throw new DeliveryRouteNotFoundError();
    await this.requireDriver(manager, organizationId, candidate.driverId, actorUserId);
    const order = await manager.findOne(DeliveryOrderEntity, {
      where: { id: orderId, organizationId },
    });
    const attempt = await manager.findOne(DeliveryAttemptEntity, {
      where: { organizationId, orderId, routeId: candidate.routeId, status: 'in_progress' },
    });
    if (order === null || attempt === null || order.activeRouteId !== candidate.routeId) {
      throw new DeliveryRouteNotFoundError();
    }
    return { order, attempt };
  }

  private async lockAvailableEvidence(manager: EntityManager, organizationId: string,
    orderId: string, attemptId: string, evidenceIds: readonly string[]) {
    if (new Set(evidenceIds).size !== evidenceIds.length) return [];
    const evidence = [];
    for (const id of evidenceIds) {
      const row = await manager.findOne(DeliveryEvidenceEntity, {
        where: { id, organizationId, orderId, attemptId, status: 'available', incidentId: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (row !== null) evidence.push(row);
    }
    return evidence;
  }
}

function outcomeTimestamp(occurredAt: string, orderUpdatedAt: Date, attemptStartedAt: Date): Date {
  return new Date(Math.max(Date.parse(occurredAt), orderUpdatedAt.getTime() + 1,
    attemptStartedAt.getTime() + 1));
}

async function insertOrderHistory(manager: EntityManager, organizationId: string, orderId: string,
  actorUserId: string, fromStatus: string, toStatus: string, occurredAt: Date): Promise<void> {
  const history = new DeliveryOrderStatusHistoryEntity();
  history.id = randomUUID(); history.orderId = orderId; history.organizationId = organizationId;
  history.fromStatus = fromStatus; history.toStatus = toStatus;
  history.actorUserId = actorUserId; history.occurredAt = occurredAt;
  await manager.insert(DeliveryOrderStatusHistoryEntity, history);
}
