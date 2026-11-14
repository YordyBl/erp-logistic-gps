import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';

import { DeliveryRouteConflictError } from '../../modules/delivery-routes/domain/errors/DeliveryRouteError.js';
import { DeliveryRouteEntity } from '../../modules/delivery-routes/infrastructure/persistence/entities/DeliveryRouteEntity.js';
import { DeliveryStopEntity } from '../../modules/delivery-routes/infrastructure/persistence/entities/DeliveryStopEntity.js';
import { DeliveryStopOrderEntity } from '../../modules/delivery-routes/infrastructure/persistence/entities/DeliveryStopOrderEntity.js';
import { DeliveryOrderEntity } from '../../modules/delivery-orders/infrastructure/persistence/entities/DeliveryOrderEntity.js';
import { DeliveryOrderPackageEntity } from '../../modules/delivery-orders/infrastructure/persistence/entities/DeliveryOrderPackageEntity.js';
import { DeliveryOrderStatusHistoryEntity } from '../../modules/delivery-orders/infrastructure/persistence/entities/DeliveryOrderStatusHistoryEntity.js';
import { DeliveryAttemptEntity } from '../../modules/delivery-execution/infrastructure/persistence/entities/DeliveryAttemptEntity.js';
import { toDomain } from '../../modules/delivery-orders/infrastructure/persistence/mappers/DeliveryOrderMapper.js';

/**
 * Starts a planned route inside the caller's transaction: every active order
 * moves to in transit with its own in-progress attempt, and the route and order
 * transitions are audited. The caller must already hold the route row lock and
 * have authorized `actorUserId`. Orders are locked in id order, the same order
 * every other route writer uses, so concurrent writers cannot deadlock.
 *
 * @returns the persisted start timestamp.
 */
export async function startRouteInTransaction(manager: EntityManager, route: DeliveryRouteEntity,
  actorUserId: string, occurredAt: string): Promise<Date> {
  const { organizationId, id: routeId } = route;
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
  return timestamp;
}
