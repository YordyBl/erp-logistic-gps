import { SystemClock, type Clock } from '../../../shared/clock.js';
import { generateUuidV4 } from '../../../shared/ids.js';
import type { DeliveryOrder } from '../domain/entities/DeliveryOrder.js';
import type { DomainEvent } from '../domain/events/DomainEvent.js';
import type { DeliveryOrderRepository } from '../application/ports/DeliveryOrderRepository.js';
import type { EventPublisher } from '../application/ports/EventPublisher.js';
import type { IdGenerator } from '../application/ports/IdGenerator.js';
import { CreateDeliveryOrderUseCase } from '../application/use-cases/create-delivery-order/CreateDeliveryOrderUseCase.js';
import { GetDeliveryOrderUseCase } from '../application/use-cases/get-delivery-order/GetDeliveryOrderUseCase.js';

/**
 * In-memory repository for tests and the demo composition.
 *
 * It is deliberately not a production adapter: data disappears with the
 * process, reads return the stored aggregate, and there is no transaction
 * support. The PostgreSQL/TypeORM adapter arrives with the persistence phase.
 */
export class InMemoryDeliveryOrderRepository implements DeliveryOrderRepository {
  private readonly orders = new Map<string, DeliveryOrder>();

  async save(order: DeliveryOrder): Promise<void> {
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
  readonly repository: DeliveryOrderRepository;
  readonly eventPublisher: InMemoryEventPublisher;
}

/**
 * Composition root for the `delivery-orders` module.
 *
 * The pilot wires in-memory adapters so the module is runnable and testable
 * without a database. The process-wide composition root (`apps/api/src/main.ts`)
 * will replace them with TypeORM and messaging adapters in a later phase; use
 * cases do not change.
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
    repository,
    eventPublisher,
  };
}
