import { z } from 'zod';

import { DeliveryOrderValidationError } from '../../../domain/errors/DeliveryOrderError.js';
import { toDeliveryOrderDto } from '../../dto/DeliveryOrderDto.js';
import type { DeliveryOrderRepository } from '../../ports/DeliveryOrderRepository.js';

const listOrdersQuerySchema = z.strictObject({ organizationId: z.uuid() });

/** Lists only the authenticated organization's orders in repository order. */
export class ListDeliveryOrdersUseCase {
  constructor(private readonly repository: DeliveryOrderRepository) {}

  async execute(input: unknown) {
    const result = listOrdersQuerySchema.safeParse(input);
    if (!result.success) {
      throw new DeliveryOrderValidationError('List delivery orders query is invalid', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'), message: issue.message,
        })),
      });
    }

    const orders = await this.repository.list(result.data.organizationId);
    return { orders: orders.map(toDeliveryOrderDto) };
  }
}
