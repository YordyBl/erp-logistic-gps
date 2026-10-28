import type { DataSource } from 'typeorm';

import { SystemClock, type Clock } from '../../../shared/clock.js';
import { generateUuidV4 } from '../../../shared/ids.js';
import type { DeliveryOrder } from '../domain/entities/DeliveryOrder.js';
import type { DomainEvent } from '../domain/events/DomainEvent.js';
import type { DeliveryOrderRepository } from '../application/ports/DeliveryOrderRepository.js';
import type { DeliveryOrderStatusHistory } from '../application/ports/DeliveryOrderStatusHistory.js';
import type { EventPublisher } from '../application/ports/EventPublisher.js';
import type { IdGenerator } from '../application/ports/IdGenerator.js';
import { CreateDeliveryOrderUseCase } from '../application/use-cases/create-delivery-order/CreateDeliveryOrderUseCase.js';
import { GetDeliveryOrderUseCase } from '../application/use-cases/get-delivery-order/GetDeliveryOrderUseCase.js';
import { ListDeliveryOrdersUseCase } from '../application/use-cases/list-delivery-orders/ListDeliveryOrdersUseCase.js';
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

  async list(organizationId: string): Promise<readonly DeliveryOrder[]> {
    return [...this.orders.values()]
      .filter((order) => order.organizationId === organizationId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
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
  readonly listDeliveryOrders: ListDeliveryOrdersUseCase;
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
    listDeliveryOrders: new ListDeliveryOrdersUseCase(repository),
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
