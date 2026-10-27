import { DeliveryOrder } from '../../../domain/entities/DeliveryOrder.js';
import { DeliveryOrderInvariantError } from '../../../domain/errors/DeliveryOrderError.js';
import { DeliveryOrderCreated } from '../../../domain/events/DeliveryOrderCreated.js';
import { DeliveryAddress } from '../../../domain/value-objects/DeliveryAddress.js';
import { Package } from '../../../domain/value-objects/Package.js';
import { Recipient } from '../../../domain/value-objects/Recipient.js';
import { toDeliveryOrderDto } from '../../dto/DeliveryOrderDto.js';
import type { Clock } from '../../ports/Clock.js';
import type { DeliveryOrderRepository } from '../../ports/DeliveryOrderRepository.js';
import type { EventPublisher } from '../../ports/EventPublisher.js';
import type { IdGenerator } from '../../ports/IdGenerator.js';
import { parseCreateDeliveryOrderCommand } from './CreateDeliveryOrderCommand.js';
import type { CreateDeliveryOrderResult } from './CreateDeliveryOrderResult.js';

export interface CreateDeliveryOrderDependencies {
  readonly repository: DeliveryOrderRepository;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly eventPublisher: EventPublisher;
}

/**
 * Creates one delivery order inside the authenticated organization.
 *
 * The command is validated at this boundary, the aggregate enforces its
 * invariants, and the public code is checked for per-organization uniqueness
 * before storage. The order is saved before `DeliveryOrderCreated` is published;
 * a transactional outbox is a later milestone (architecture plan §11.11).
 */
export class CreateDeliveryOrderUseCase {
  constructor(private readonly dependencies: CreateDeliveryOrderDependencies) {}

  async execute(input: unknown): Promise<CreateDeliveryOrderResult> {
    const command = parseCreateDeliveryOrderCommand(input);

    const recipient = Recipient.create(command.recipient);
    const deliveryAddress = DeliveryAddress.create(command.deliveryAddress);
    const packages = command.packages.map((item) => Package.create(item));

    const existing = await this.dependencies.repository.findByPublicCode(
      command.organizationId,
      command.publicCode,
    );
    if (existing !== null) {
      throw new DeliveryOrderInvariantError(
        `Public code ${command.publicCode} is already used in organization ${command.organizationId}`,
        {
          field: 'publicCode',
          publicCode: command.publicCode,
          organizationId: command.organizationId,
        },
      );
    }

    const createdAt = this.dependencies.clock.now();
    const order = DeliveryOrder.create({
      id: this.dependencies.idGenerator.nextId(),
      organizationId: command.organizationId,
      publicCode: command.publicCode,
      recipient,
      deliveryAddress,
      packages,
      createdAt,
    });

    await this.dependencies.repository.save(order);

    await this.dependencies.eventPublisher.publish(
      new DeliveryOrderCreated({
        orderId: order.id,
        organizationId: order.organizationId,
        publicCode: order.publicCode,
        occurredAt: order.createdAt,
      }),
    );

    return { order: toDeliveryOrderDto(order) };
  }
}
