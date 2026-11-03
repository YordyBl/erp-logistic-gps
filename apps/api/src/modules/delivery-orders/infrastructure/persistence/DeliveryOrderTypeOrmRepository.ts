import type { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import type { DeliveryOrderRepository } from '../../application/ports/DeliveryOrderRepository.js';
import type { DeliveryOrderStatusHistory } from '../../application/ports/DeliveryOrderStatusHistory.js';
import { DeliveryOrder } from '../../domain/entities/DeliveryOrder.js';
import {
  DeliveryOrderForbiddenError,
  DeliveryOrderInvariantError,
  DeliveryOrderNotFoundError,
} from '../../domain/errors/DeliveryOrderError.js';
import { isDeliveryOrderStatus } from '../../domain/policies/DeliveryOrderStatusPolicy.js';
import { DeliveryOrderEntity } from './entities/DeliveryOrderEntity.js';
import { DeliveryOrderPackageEntity } from './entities/DeliveryOrderPackageEntity.js';
import { DeliveryOrderStatusHistoryEntity } from './entities/DeliveryOrderStatusHistoryEntity.js';
import {
  toDomain,
  toOrderEntity,
  toPackageEntities,
} from './mappers/DeliveryOrderMapper.js';

/**
 * PostgreSQL adapter for the {@link DeliveryOrderRepository} port.
 *
 * Tenant scoping follows the port contract:
 * - `findByPublicCode` always filters by `organizationId` (codes are unique per
 *   organization).
 * - `findById` intentionally does not filter: the read use case must tell
 *   "missing" apart from "owned by another organization" and raise the typed
 *   forbidden error itself.
 *
 * The aggregate is saved whole. The order row and its package rows commit in
 * one transaction, so a failed package write never leaves a partial order. This
 * transaction is internal to one aggregate; coordinated multi-aggregate
 * transactions remain a use-case concern through a future unit-of-work port
 * (ADR-002 §4).
 */
export class DeliveryOrderTypeOrmRepository implements DeliveryOrderRepository {
  constructor(private readonly dataSource: DataSource) {}

  async nextCodes(packageCount: number): Promise<{
    readonly publicCode: string;
    readonly packageCodes: readonly string[];
  }> {
    const [orderRows, packageRows] = await Promise.all([
      this.dataSource.query('SELECT nextval(\'delivery_order_public_code_seq\') AS value'),
      this.dataSource.query(
        'SELECT nextval(\'delivery_order_package_code_seq\') AS value FROM generate_series(1, $1)',
        [packageCount],
      ),
    ]) as [{ value: string }[], { value: string }[]];
    return {
      publicCode: formatGeneratedCode('ORD', Number(orderRows[0]?.value)),
      packageCodes: packageRows.map((row) => formatGeneratedCode('PKG', Number(row.value))),
    };
  }

  async save(order: DeliveryOrder): Promise<void> {
    const orderEntity = toOrderEntity(order);
    const packageEntities = toPackageEntities(order);

    try {
      await this.dataSource.transaction(async (manager) => {
        const existing = await manager.findOne(DeliveryOrderEntity, {
          where: { id: order.id }, lock: { mode: 'pessimistic_write' },
        });
        // Pilot save is for initial orders only: never resurrect a cancelled
        // order from a stale aggregate after its audited transition commits.
        if (order.status !== 'created' || (existing !== null && existing.status !== 'created')) {
          throw new DeliveryOrderInvariantError('Status changes require an audited transition');
        }
        await manager.save(orderEntity);
        await manager.delete(DeliveryOrderPackageEntity, {
          deliveryOrderId: order.id,
        });

        if (packageEntities.length > 0) {
          await manager.save(packageEntities);
        }
      });
    } catch (error) {
      throw translatePersistenceError(error, order);
    }
  }

  async findById(orderId: string): Promise<DeliveryOrder | null> {
    const orderEntity = await this.dataSource.getRepository(DeliveryOrderEntity).findOne({
      where: { id: orderId },
      relations: { packages: true },
    });

    if (orderEntity === null) {
      return null;
    }

    return toDomain(orderEntity, orderEntity.packages);
  }

  async findByPublicCode(
    organizationId: string,
    publicCode: string,
  ): Promise<DeliveryOrder | null> {
    const orderEntity = await this.dataSource.getRepository(DeliveryOrderEntity).findOne({
      where: { organizationId, publicCode },
      relations: { packages: true },
    });

    if (orderEntity === null) {
      return null;
    }

    return toDomain(orderEntity, orderEntity.packages);
  }

  async list(organizationId: string): Promise<readonly DeliveryOrder[]> {
    const entities = await this.dataSource.getRepository(DeliveryOrderEntity).find({
      where: { organizationId },
      relations: { packages: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return entities.map((entity) => toDomain(entity, entity.packages));
  }

  async editDetails(organizationId: string, orderId: string, changes: Parameters<DeliveryOrderRepository['editDetails']>[2], occurredAt: string): Promise<DeliveryOrder> {
    return this.dataSource.transaction(async (manager) => {
      const entity = await manager.findOne(DeliveryOrderEntity, {
        where: { id: orderId }, lock: { mode: 'pessimistic_write' },
      });
      if (entity === null) throw new DeliveryOrderNotFoundError(orderId);
      if (entity.organizationId !== organizationId) throw new DeliveryOrderForbiddenError(orderId, organizationId);
      const packages = await manager.find(DeliveryOrderPackageEntity, {
        where: { deliveryOrderId: orderId },
      });
      const edited = toDomain(entity, packages).editDetails(changes, occurredAt);
      const mapped = toOrderEntity(edited);
      await manager.update(DeliveryOrderEntity, { id: orderId, organizationId }, {
        recipientName: mapped.recipientName, recipientPhone: mapped.recipientPhone,
        deliveryAddressLine: mapped.deliveryAddressLine, deliveryDistrict: mapped.deliveryDistrict,
        googleMapsUrl: mapped.googleMapsUrl,
        latitude: mapped.latitude, longitude: mapped.longitude, updatedAt: mapped.updatedAt,
      });
      if (changes.packages !== undefined) {
        await manager.delete(DeliveryOrderPackageEntity, { deliveryOrderId: orderId });
        await manager.save(toPackageEntities(edited));
      }
      return edited;
    });
  }

  async cancel(
    organizationId: string, orderId: string, actorUserId: string, occurredAt: string,
  ): Promise<DeliveryOrder> {
    return this.dataSource.transaction(async (manager) => {
      const entity = await manager.findOne(DeliveryOrderEntity, {
        where: { id: orderId }, lock: { mode: 'pessimistic_write' },
      });
      if (entity === null) throw new DeliveryOrderNotFoundError(orderId);
      if (entity.organizationId !== organizationId) {
        throw new DeliveryOrderForbiddenError(orderId, organizationId);
      }
      const packages = await manager.find(DeliveryOrderPackageEntity, {
        where: { deliveryOrderId: orderId },
      });
      const original = toDomain(entity, packages);
      const cancelled = original.cancel(occurredAt);
      await manager.update(DeliveryOrderEntity, { id: orderId, organizationId }, {
        status: cancelled.status, updatedAt: new Date(cancelled.updatedAt),
      });
      const history = new DeliveryOrderStatusHistoryEntity();
      history.id = randomUUID();
      history.orderId = orderId;
      history.organizationId = organizationId;
      history.fromStatus = original.status;
      history.toStatus = cancelled.status;
      history.actorUserId = actorUserId;
      history.occurredAt = new Date(cancelled.updatedAt);
      await manager.save(history);
      return cancelled;
    });
  }

  async findStatusHistory(organizationId: string, orderId: string): Promise<readonly DeliveryOrderStatusHistory[]> {
    const order = await this.dataSource.getRepository(DeliveryOrderEntity).findOne({
      where: { id: orderId, organizationId },
    });
    if (order === null) throw new DeliveryOrderNotFoundError(orderId);
    const events = await this.dataSource.getRepository(DeliveryOrderStatusHistoryEntity).find({
      where: { orderId, organizationId }, order: { occurredAt: 'ASC', id: 'ASC' },
    });
    return events.map((event) => {
      if (!isDeliveryOrderStatus(event.fromStatus) || !isDeliveryOrderStatus(event.toStatus)) {
        throw new DeliveryOrderInvariantError('Persisted delivery order history status is invalid');
      }
      return {
        fromStatus: event.fromStatus, toStatus: event.toStatus,
        actorUserId: event.actorUserId, occurredAt: event.occurredAt.toISOString(),
      };
    });
  }
}

function formatGeneratedCode(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(8, '0')}`;
}

interface PostgresDriverError {
  readonly code?: string;
  readonly constraint?: string;
}

interface DriverErrorCarrier {
  readonly driverError?: unknown;
}

/**
 * Maps the database-level unique guard to the same typed invariant error the
 * use case raises before saving, so a concurrent duplicate code cannot surface
 * as an untyped driver error.
 */
function translatePersistenceError(error: unknown, order: DeliveryOrder): Error {
  const driverError = readPostgresDriverError(error);

  if (
    driverError?.code === '23505' &&
    driverError.constraint === 'uq_delivery_orders_organization_public_code'
  ) {
    return new DeliveryOrderInvariantError(
      `Public code ${order.publicCode} is already used in organization ${order.organizationId}`,
      {
        field: 'publicCode',
        publicCode: order.publicCode,
        organizationId: order.organizationId,
      },
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

function readPostgresDriverError(error: unknown): PostgresDriverError | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const driverError = (error as DriverErrorCarrier).driverError;
  if (typeof driverError !== 'object' || driverError === null) {
    return undefined;
  }

  return driverError as PostgresDriverError;
}
