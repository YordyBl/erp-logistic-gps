import type { DataSource } from 'typeorm';

import { SystemClock, type Clock } from '../../../shared/clock.js';
import { generateUuidV4 } from '../../../shared/ids.js';
import { pageOffset, type PageResult } from '../../../http/pagination.js';
import { DELIVERY_TIME_WINDOWS, type DeliveryOrder } from '../domain/entities/DeliveryOrder.js';
import type { DomainEvent } from '../domain/events/DomainEvent.js';
import { DELIVERY_ORDER_STATUSES } from '../domain/policies/DeliveryOrderStatusPolicy.js';
import type {
  DeliveryOrderPageCriteria,
  DeliveryOrderRepository,
  DeliveryOrderSortField,
} from '../application/ports/DeliveryOrderRepository.js';
import { ListDeliveryOrdersPageUseCase } from '../application/use-cases/list-delivery-orders/ListDeliveryOrdersPageUseCase.js';
import type { DeliveryOrderStatusHistory } from '../application/ports/DeliveryOrderStatusHistory.js';
import type { EventPublisher } from '../application/ports/EventPublisher.js';
import type { IdGenerator } from '../application/ports/IdGenerator.js';
import { CreateDeliveryOrderUseCase } from '../application/use-cases/create-delivery-order/CreateDeliveryOrderUseCase.js';
import { GetDeliveryOrderUseCase } from '../application/use-cases/get-delivery-order/GetDeliveryOrderUseCase.js';
import { EditDeliveryOrderUseCase } from '../application/use-cases/edit-delivery-order/EditDeliveryOrderUseCase.js';
import { CancelDeliveryOrderUseCase } from '../application/use-cases/cancel-delivery-order/CancelDeliveryOrderUseCase.js';
import { DeliveryOrderForbiddenError, DeliveryOrderInvariantError, DeliveryOrderNotFoundError } from '../domain/errors/DeliveryOrderError.js';

/**
 * In-memory repository for tests and the demo composition.
 *
 * It is deliberately not a production adapter: data disappears with the
 * process, reads return the stored aggregate, and there is no transaction
 * support. The PostgreSQL/TypeORM adapter arrives with the persistence phase.
 */
export class InMemoryDeliveryOrderRepository implements DeliveryOrderRepository {
  private readonly orders = new Map<string, DeliveryOrder>();
  private readonly statusHistory = new Map<string, DeliveryOrderStatusHistory[]>();
  private nextOrderNumber = 1;
  private nextPackageNumber = 1;

  async nextCodes(packageCount: number): Promise<{
    readonly publicCode: string;
    readonly packageCodes: readonly string[];
  }> {
    const publicCode = formatGeneratedCode('ORD', this.nextOrderNumber++);
    const packageCodes = Array.from({ length: packageCount }, () =>
      formatGeneratedCode('PKG', this.nextPackageNumber++));
    return { publicCode, packageCodes };
  }

  async nextPackageCodes(count: number): Promise<readonly string[]> {
    return Array.from({ length: count }, () => formatGeneratedCode('PKG', this.nextPackageNumber++));
  }

  async save(order: DeliveryOrder): Promise<void> {
    const existing = this.orders.get(order.id);
    if (order.status !== 'created' || (existing !== undefined && existing.status !== 'created')) {
      throw new DeliveryOrderInvariantError('Status changes require an audited transition');
    }
    this.orders.set(order.id, order);
  }

  async findById(orderId: string): Promise<DeliveryOrder | null> {
    return this.orders.get(orderId) ?? null;
  }

  async findByPublicCode(
    organizationId: string,
    publicCode: string,
  ): Promise<DeliveryOrder | null> {
    for (const order of this.orders.values()) {
      if (order.organizationId === organizationId && order.publicCode === publicCode) {
        return order;
      }
    }

    return null;
  }

  /** Same filters, facet counts, order and slicing as the PostgreSQL adapter. */
  async listPage(organizationId: string, criteria: DeliveryOrderPageCriteria): Promise<PageResult<DeliveryOrder>> {
    const tenantOrders = [...this.orders.values()].filter((order) => order.organizationId === organizationId);
    const matching = (omit?: 'status' | 'timeWindow') =>
      tenantOrders.filter((order) => matchesPageCriteria(order, criteria, omit));

    const status = Object.fromEntries(DELIVERY_ORDER_STATUSES.map((value) => [value, 0])) as Record<string, number>;
    for (const order of matching('status')) status[order.status] = (status[order.status] ?? 0) + 1;
    const timeWindow = Object.fromEntries(DELIVERY_TIME_WINDOWS.map((value) => [value, 0])) as Record<string, number>;
    for (const order of matching('timeWindow')) timeWindow[order.timeWindow] = (timeWindow[order.timeWindow] ?? 0) + 1;

    const filtered = matching();
    const sign = criteria.sort.direction === 'asc' ? 1 : -1;
    const sorted = filtered.sort((left, right) => sign * (
      compareText(sortValue(left, criteria.sort.field), sortValue(right, criteria.sort.field))
      || compareText(left.id, right.id)
    ));
    const offset = pageOffset(criteria);
    return {
      items: sorted.slice(offset, offset + criteria.pageSize),
      total: filtered.length,
      counts: { status, timeWindow },
    };
  }

  async editDetails(organizationId: string, orderId: string, changes: Parameters<DeliveryOrderRepository['editDetails']>[2], occurredAt: string): Promise<DeliveryOrder> {
    const order = this.orders.get(orderId);
    if (order === undefined) throw new DeliveryOrderNotFoundError(orderId);
    if (order.organizationId !== organizationId) throw new DeliveryOrderForbiddenError(orderId, organizationId);
    const edited = order.editDetails(changes, occurredAt);
    this.orders.set(orderId, edited);
    return edited;
  }

  /** Stage all order transitions before applying any, so rejected plans write nothing. */
  planAndAssign(organizationId: string, routeId: string, orderIds: readonly string[],
    actorUserId: string, plannedAt: string, assignedAt: string): void {
    const staged = orderIds.map((id) => {
      const original = this.orders.get(id);
      if (original === undefined || original.organizationId !== organizationId) {
        throw new DeliveryOrderNotFoundError(id);
      }
      return { id, original, ...original.planAndAssign(routeId, plannedAt, assignedAt) };
    });
    for (const { id, original, assigned, planned } of staged) {
      this.orders.set(id, assigned);
      this.statusHistory.set(id, [
        ...(this.statusHistory.get(id) ?? []),
        { fromStatus: original.status, toStatus: planned.status, actorUserId, occurredAt: planned.updatedAt },
        { fromStatus: planned.status, toStatus: assigned.status, actorUserId, occurredAt: assigned.updatedAt },
      ]);
    }
  }

  /** Stage every transition before mutating any stored order or audit list. */
  startRoute(organizationId: string, routeId: string, orderIds: readonly string[],
    actorUserId: string, occurredAt: string): void {
    const staged = orderIds.map((id) => {
      const original = this.orders.get(id);
      if (original === undefined || original.organizationId !== organizationId) {
        throw new DeliveryOrderNotFoundError(id);
      }
      const timestamp = new Date(Math.max(Date.parse(occurredAt), Date.parse(original.updatedAt) + 1))
        .toISOString();
      return { id, original, updated: original.startTransit(routeId, timestamp) };
    });
    for (const { id, original, updated } of staged) {
      this.orders.set(id, updated);
      this.statusHistory.set(id, [...(this.statusHistory.get(id) ?? []), {
        fromStatus: original.status, toStatus: updated.status,
        actorUserId, occurredAt: updated.updatedAt,
      }]);
    }
  }

  async cancel(organizationId: string, orderId: string, actorUserId: string, occurredAt: string): Promise<DeliveryOrder> {
    const order = this.orders.get(orderId);
    if (order === undefined) throw new DeliveryOrderNotFoundError(orderId);
    if (order.organizationId !== organizationId) {
      throw new DeliveryOrderForbiddenError(orderId, organizationId);
    }
    const cancelled = order.cancel(occurredAt);
    const prior = this.statusHistory.get(orderId) ?? [];
    this.statusHistory.set(orderId, [...prior, {
      fromStatus: order.status, toStatus: cancelled.status, actorUserId, occurredAt,
    }]);
    this.orders.set(orderId, cancelled);
    return cancelled;
  }

  async findStatusHistory(organizationId: string, orderId: string): Promise<readonly DeliveryOrderStatusHistory[]> {
    const order = this.orders.get(orderId);
    if (order === undefined) throw new DeliveryOrderNotFoundError(orderId);
    if (order.organizationId !== organizationId) throw new DeliveryOrderForbiddenError(orderId, organizationId);
    return this.statusHistory.get(orderId) ?? [];
  }
}

function formatGeneratedCode(prefix: string, value: number): string {
  return `${prefix}-${String(value).padStart(8, '0')}`;
}

/** `omit` skips one facet's own filter so its counts show every option. */
function matchesPageCriteria(
  order: DeliveryOrder,
  criteria: DeliveryOrderPageCriteria,
  omit?: 'status' | 'timeWindow',
): boolean {
  if (omit !== 'status' && criteria.status !== undefined && !criteria.status.includes(order.status)) return false;
  if (omit !== 'timeWindow' && criteria.timeWindow !== undefined
    && !criteria.timeWindow.includes(order.timeWindow)) return false;
  if (criteria.customerId !== undefined && order.customerId !== criteria.customerId) return false;
  if (criteria.ids !== undefined && !criteria.ids.includes(order.id)) return false;
  if (criteria.q === undefined) return true;
  const needle = criteria.q.toLocaleLowerCase();
  return [
    order.publicCode, order.recipient.name, order.recipient.phone,
    order.deliveryAddress.addressLine, order.deliveryAddress.district,
  ].some((value) => value.toLocaleLowerCase().includes(needle));
}

function sortValue(order: DeliveryOrder, field: DeliveryOrderSortField): string {
  switch (field) {
    case 'publicCode': return order.publicCode;
    case 'createdAt': return order.createdAt;
    case 'recipientName': return order.recipient.name;
    case 'district': return order.deliveryAddress.district;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class CryptoIdGenerator implements IdGenerator {
  nextId(): string {
    return generateUuidV4();
  }
}

/**
 * Records published domain events in memory.
 *
 * The array is exposed for tests and demo observability; a real message bus or
 * outbox replaces this adapter behind the same {@link EventPublisher} port.
 */
export class InMemoryEventPublisher implements EventPublisher {
  private readonly published: DomainEvent[] = [];

  get events(): readonly DomainEvent[] {
    return this.published;
  }

  async publish(event: DomainEvent): Promise<void> {
    this.published.push(event);
  }
}

export interface DeliveryOrdersModuleOptions {
  readonly repository?: DeliveryOrderRepository;
  readonly idGenerator?: IdGenerator;
  readonly clock?: Clock;
  readonly eventPublisher?: InMemoryEventPublisher;
}

export interface DeliveryOrdersModule {
  readonly createDeliveryOrder: CreateDeliveryOrderUseCase;
  readonly getDeliveryOrder: GetDeliveryOrderUseCase;
  readonly listDeliveryOrdersPage: ListDeliveryOrdersPageUseCase;
  readonly editDeliveryOrder: EditDeliveryOrderUseCase;
  readonly cancelDeliveryOrder: CancelDeliveryOrderUseCase;
  readonly repository: DeliveryOrderRepository;
  readonly eventPublisher: InMemoryEventPublisher;
}

/**
 * Composition root for the `delivery-orders` module.
 *
 * The default wiring uses in-memory adapters so the module is runnable and
 * testable without a database. The HTTP process composes the same use cases with
 * PostgreSQL through {@link createDeliveryOrdersModuleFromDataSource}; use cases
 * do not change.
 */
export function createDeliveryOrdersModule(
  options: DeliveryOrdersModuleOptions = {},
): DeliveryOrdersModule {
  const repository = options.repository ?? new InMemoryDeliveryOrderRepository();
  const idGenerator = options.idGenerator ?? new CryptoIdGenerator();
  const clock = options.clock ?? new SystemClock();
  const eventPublisher = options.eventPublisher ?? new InMemoryEventPublisher();

  return {
    createDeliveryOrder: new CreateDeliveryOrderUseCase({
      repository,
      idGenerator,
      clock,
      eventPublisher,
    }),
    getDeliveryOrder: new GetDeliveryOrderUseCase({ repository }),
    listDeliveryOrdersPage: new ListDeliveryOrdersPageUseCase(repository),
    editDeliveryOrder: new EditDeliveryOrderUseCase(repository, clock),
    cancelDeliveryOrder: new CancelDeliveryOrderUseCase(repository, clock),
    repository,
    eventPublisher,
  };
}

/**
 * Composes the module with the PostgreSQL adapter for one initialized (or soon
 * to be initialized) data source.
 *
 * The adapter is imported dynamically so importing this file from unit tests
 * does not load TypeORM entities and decorators. Callers own the data source
 * lifecycle; this factory only wires the repository port.
 */
export async function createDeliveryOrdersModuleFromDataSource(
  dataSource: DataSource,
  options: Omit<DeliveryOrdersModuleOptions, 'repository'> = {},
): Promise<DeliveryOrdersModule> {
  const { DeliveryOrderTypeOrmRepository } = await import(
    '../infrastructure/persistence/DeliveryOrderTypeOrmRepository.js'
  );

  return createDeliveryOrdersModule({
    ...options,
    repository: new DeliveryOrderTypeOrmRepository(dataSource),
  });
}
