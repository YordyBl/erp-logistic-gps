import { z } from 'zod';

import { DeliveryOrderValidationError } from '../../../domain/errors/DeliveryOrderError.js';
import { DeliveryAddress } from '../../../domain/value-objects/DeliveryAddress.js';
import { Package } from '../../../domain/value-objects/Package.js';
import { Recipient } from '../../../domain/value-objects/Recipient.js';
import { toDeliveryOrderDto } from '../../dto/DeliveryOrderDto.js';
import type { Clock } from '../../ports/Clock.js';
import type { DeliveryOrderRepository } from '../../ports/DeliveryOrderRepository.js';
import { deliveryAddressSchema, deliveryOrderPackageSchema } from '../create-delivery-order/CreateDeliveryOrderCommand.js';

export const editOrderBodySchema = z.strictObject({
  recipient: z.strictObject({ name: z.string().trim().min(1).max(120), phone: z.string().trim().min(6).max(20).regex(/^\+?[0-9][0-9 ()-]*$/) }).optional(),
  // The address is replaced as a whole, so an edit can never drop the coordinates.
  deliveryAddress: deliveryAddressSchema.optional(),
  // Existing packages keep their code; a package without one is new and gets a generated code.
  packages: z.array(deliveryOrderPackageSchema.extend({
    code: deliveryOrderPackageSchema.shape.code.optional(),
  })).min(1).max(100).optional(),
})
  .refine((value) => Object.keys(value).length > 0, 'At least one detail must be provided');

type EditPackageInput = NonNullable<z.infer<typeof editOrderBodySchema>['packages']>[number];

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
    const packages = changes.packages === undefined ? undefined : await this.withCodes(changes.packages);
    const order = await this.repository.editDetails(organizationId, orderId, {
      ...(changes.recipient === undefined ? {} : { recipient: Recipient.create(changes.recipient) }),
      ...(changes.deliveryAddress === undefined ? {} : { deliveryAddress: DeliveryAddress.create(changes.deliveryAddress) }),
      ...(packages === undefined ? {} : { packages }),
    }, this.clock.now());
    return { order: toDeliveryOrderDto(order) };
  }

  private async withCodes(items: readonly EditPackageInput[]): Promise<Package[]> {
    const generated = [...await this.repository.nextPackageCodes(items.filter((item) => item.code === undefined).length)];
    return items.map((item) => Package.create({ ...item, code: item.code ?? generated.shift()! }));
  }
}
