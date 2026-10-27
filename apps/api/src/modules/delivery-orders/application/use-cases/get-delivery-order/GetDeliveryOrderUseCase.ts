import {
  DeliveryOrderForbiddenError,
  DeliveryOrderNotFoundError,
} from '../../../domain/errors/DeliveryOrderError.js';
import { toDeliveryOrderDto } from '../../dto/DeliveryOrderDto.js';
import type { DeliveryOrderRepository } from '../../ports/DeliveryOrderRepository.js';
import { parseGetDeliveryOrderQuery } from './GetDeliveryOrderQuery.js';
import type { GetDeliveryOrderResult } from './GetDeliveryOrderResult.js';

export interface GetDeliveryOrderDependencies {
  readonly repository: DeliveryOrderRepository;
}

/**
 * Reads one delivery order after checking tenant ownership.
 *
 * A missing order and an order owned by another organization are distinct typed
 * errors in the application layer. The HTTP mapping decides whether to expose
 * the distinction; see the module `decisions.md` for the enumeration trade-off.
 */
export class GetDeliveryOrderUseCase {
  constructor(private readonly dependencies: GetDeliveryOrderDependencies) {}

  async execute(input: unknown): Promise<GetDeliveryOrderResult> {
    const query = parseGetDeliveryOrderQuery(input);

    const order = await this.dependencies.repository.findById(query.orderId);
    if (order === null) {
      throw new DeliveryOrderNotFoundError(query.orderId);
    }

    if (order.organizationId !== query.organizationId) {
      throw new DeliveryOrderForbiddenError(order.id, query.organizationId);
    }

    return { order: toDeliveryOrderDto(order) };
  }
}
