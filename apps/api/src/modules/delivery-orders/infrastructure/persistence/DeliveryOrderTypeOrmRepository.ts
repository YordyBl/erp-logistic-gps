import type { DataSource } from 'typeorm';

import type { DeliveryOrderRepository } from '../../application/ports/DeliveryOrderRepository.js';
import { DeliveryOrder } from '../../domain/entities/DeliveryOrder.js';
import { DeliveryOrderInvariantError } from '../../domain/errors/DeliveryOrderError.js';
import { DeliveryOrderEntity } from './entities/DeliveryOrderEntity.js';
import { DeliveryOrderPackageEntity } from './entities/DeliveryOrderPackageEntity.js';
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

  async save(order: DeliveryOrder): Promise<void> {
    const orderEntity = toOrderEntity(order);
    const packageEntities = toPackageEntities(order);

    try {
      await this.dataSource.transaction(async (manager) => {
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
