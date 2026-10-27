import { z } from 'zod';

import { toDeliveryOrderDto } from '../../dto/DeliveryOrderDto.js';
import type { DeliveryOrderRepository } from '../../ports/DeliveryOrderRepository.js';
import type { Clock } from '../../ports/Clock.js';
import { DeliveryOrderValidationError } from '../../../domain/errors/DeliveryOrderError.js';

const cancelCommandSchema = z.strictObject({
  organizationId: z.uuid(),
  orderId: z.uuid(),
  actorUserId: z.uuid(),
});

export class CancelDeliveryOrderUseCase {
  constructor(private readonly repository: DeliveryOrderRepository, private readonly clock: Clock) {}

  async execute(input: unknown) {
    const result = cancelCommandSchema.safeParse(input);
    if (!result.success) {
      throw new DeliveryOrderValidationError('Cancel delivery order command is invalid', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'), message: issue.message,
        })),
      });
    }
    const { organizationId, orderId, actorUserId } = result.data;
    const order = await this.repository.cancel(organizationId, orderId, actorUserId, this.clock.now());
    return { order: toDeliveryOrderDto(order) };
  }
}
