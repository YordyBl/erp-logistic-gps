import { Brackets, In, type DataSource, type SelectQueryBuilder } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { pageOffset, type PageResult } from '../../../../http/pagination.js';
import type {
  DeliveryOrderPageCriteria,
  DeliveryOrderRepository,
  DeliveryOrderSortField,
} from '../../application/ports/DeliveryOrderRepository.js';
import type { DeliveryOrderStatusHistory } from '../../application/ports/DeliveryOrderStatusHistory.js';
import { DELIVERY_TIME_WINDOWS, DeliveryOrder } from '../../domain/entities/DeliveryOrder.js';
import {
  DeliveryOrderForbiddenError,
  DeliveryOrderInvariantError,
  DeliveryOrderNotFoundError,
} from '../../domain/errors/DeliveryOrderError.js';
import { DELIVERY_ORDER_STATUSES, isDeliveryOrderStatus } from '../../domain/policies/DeliveryOrderStatusPolicy.js';
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

  async nextPackageCodes(count: number): Promise<readonly string[]> {
    if (count === 0) return [];
    const rows = await this.dataSource.query(
      'SELECT nextval(\'delivery_order_package_code_seq\') AS value FROM generate_series(1, $1)',
      [count],
    ) as { value: string }[];
    return rows.map((row) => formatGeneratedCode('PKG', Number(row.value)));
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

  /**
   * Loads the page's order rows first (filtered, sorted, `OFFSET`/`LIMIT`) and
   * then their packages in one `IN` query, so the limit applies to orders and
   * not to joined package rows. Facet counts are `GROUP BY` queries that leave
   * out the facet's own filter.
   */
  async listPage(organizationId: string, criteria: DeliveryOrderPageCriteria): Promise<PageResult<DeliveryOrder>> {
    const orders = this.dataSource.getRepository(DeliveryOrderEntity);
    const filtered = (omit?: 'status' | 'timeWindow'): SelectQueryBuilder<DeliveryOrderEntity> =>
      applyPageFilters(orders.createQueryBuilder('o'), organizationId, criteria, omit);
    const direction = criteria.sort.direction === 'asc' ? 'ASC' : 'DESC';

    const [[entities, total], statusRows, timeWindowRows] = await Promise.all([
      filtered()
        .orderBy(`o.${SORT_PROPERTIES[criteria.sort.field]}`, direction)
        .addOrderBy('o.id', direction)
        .offset(pageOffset(criteria))
        .limit(criteria.pageSize)
        .getManyAndCount(),
      filtered('status').select('o.status', 'value').addSelect('COUNT(*)::integer', 'count')
        .groupBy('o.status').getRawMany<FacetRow>(),
      filtered('timeWindow').select('o.timeWindow', 'value').addSelect('COUNT(*)::integer', 'count')
        .groupBy('o.timeWindow').getRawMany<FacetRow>(),
    ]);

    const packages = entities.length === 0 ? [] : await this.dataSource.getRepository(DeliveryOrderPackageEntity).find({
      where: { deliveryOrderId: In(entities.map((entity) => entity.id)) },
    });
    const packagesByOrder = new Map<string, DeliveryOrderPackageEntity[]>();
    for (const item of packages) {
      const list = packagesByOrder.get(item.deliveryOrderId) ?? [];
      list.push(item);
      packagesByOrder.set(item.deliveryOrderId, list);
    }

    return {
      // `toDomain` restores package order from `position`.
      items: entities.map((entity) => toDomain(entity, packagesByOrder.get(entity.id) ?? [])),
      total,
      counts: {
        status: facetCounts(DELIVERY_ORDER_STATUSES, statusRows),
        timeWindow: facetCounts(DELIVERY_TIME_WINDOWS, timeWindowRows),
      },
    };
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

const SORT_PROPERTIES: Record<DeliveryOrderSortField, keyof DeliveryOrderEntity> = {
  publicCode: 'publicCode',
  createdAt: 'createdAt',
  recipientName: 'recipientName',
  district: 'deliveryDistrict',
};

interface FacetRow {
  readonly value: string;
  readonly count: number | string;
}

/** Every possible value with its count, 0 when no row matched. */
function facetCounts(values: readonly string[], rows: readonly FacetRow[]): Record<string, number> {
  const counts = Object.fromEntries(values.map((value) => [value, 0])) as Record<string, number>;
  for (const row of rows) counts[row.value] = Number(row.count);
  return counts;
}

/** Escapes `ILIKE` wildcards so the search text matches literally. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** Tenant scope plus every page filter except `omit` (a facet's own filter). */
function applyPageFilters(
  query: SelectQueryBuilder<DeliveryOrderEntity>,
  organizationId: string,
  criteria: DeliveryOrderPageCriteria,
  omit?: 'status' | 'timeWindow',
): SelectQueryBuilder<DeliveryOrderEntity> {
  query.where('o.organizationId = :organizationId', { organizationId });
  if (omit !== 'status' && criteria.status !== undefined) {
    query.andWhere('o.status IN (:...status)', { status: criteria.status });
  }
  if (omit !== 'timeWindow' && criteria.timeWindow !== undefined) {
    query.andWhere('o.timeWindow IN (:...timeWindow)', { timeWindow: criteria.timeWindow });
  }
  if (criteria.customerId !== undefined) {
    query.andWhere('o.customerId = :customerId', { customerId: criteria.customerId });
  }
  if (criteria.ids !== undefined) {
    query.andWhere('o.id IN (:...ids)', { ids: criteria.ids });
  }
  if (criteria.q !== undefined) {
    query.andWhere(new Brackets((search) => {
      for (const property of ['publicCode', 'recipientName', 'recipientPhone', 'deliveryAddressLine', 'deliveryDistrict']) {
        search.orWhere(`o.${property} ILIKE :q ESCAPE '\\'`, { q: likePattern(criteria.q!) });
      }
    }));
  }
  return query;
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
