import { z } from 'zod';

import { DeliveryOrderValidationError } from '../../../domain/errors/DeliveryOrderError.js';
import { DeliveryAddress } from '../../../domain/value-objects/DeliveryAddress.js';
import { Package } from '../../../domain/value-objects/Package.js';
import { Recipient } from '../../../domain/value-objects/Recipient.js';
import { toDeliveryOrderDto } from '../../dto/DeliveryOrderDto.js';
import type { Clock } from '../../ports/Clock.js';
import type { DeliveryOrderRepository } from '../../ports/DeliveryOrderRepository.js';
import { deliveryOrderPackageSchema } from '../create-delivery-order/CreateDeliveryOrderCommand.js';

export const editOrderBodySchema = z.strictObject({
  recipient: z.strictObject({ name: z.string().trim().min(1).max(120), phone: z.string().trim().min(6).max(20).regex(/^\+?[0-9][0-9 ()-]*$/) }).optional(),
  deliveryAddress: z.strictObject({
    addressLine: z.string().trim().min(5).max(200), district: z.string().trim().min(2).max(80),
    googleMapsUrl: z.string().trim().url().max(2048).optional(),
    latitude: z.number().finite().min(-90).max(90).optional(), longitude: z.number().finite().min(-180).max(180).optional(),
  }).refine((value) => (value.latitude === undefined) === (value.longitude === undefined), {
    message: 'latitude and longitude must be provided together', path: ['latitude'],
  }).optional(),
  packages: z.array(deliveryOrderPackageSchema).min(1).max(100).optional(),
})
  .refine((value) => Object.keys(value).length > 0, 'At least one detail must be provided');

const editOrderCommandSchema = z.strictObject({
  organizationId: z.uuid(),
  orderId: z.uuid(),
  changes: editOrderBodySchema,
});

export class EditDeliveryOrderUseCase {
  constructor(private readonly repository: DeliveryOrderRepository, private readonly clock: Clock) {}

  async execute(input: unknown) {
    const parsed = editOrderCommandSchema.safeParse(input);
    if (!parsed.success) {
      throw new DeliveryOrderValidationError('Edit delivery order command is invalid', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'), message: issue.message,
        })),
      });
    }
    const { organizationId, orderId, changes } = parsed.data;
    const order = await this.repository.editDetails(organizationId, orderId, {
      ...(changes.recipient === undefined ? {} : { recipient: Recipient.create(changes.recipient) }),
      ...(changes.deliveryAddress === undefined ? {} : { deliveryAddress: DeliveryAddress.create(changes.deliveryAddress) }),
      ...(changes.packages === undefined ? {} : { packages: changes.packages.map((item) => Package.create(item)) }),
    }, this.clock.now());
    return { order: toDeliveryOrderDto(order) };
  }
}
