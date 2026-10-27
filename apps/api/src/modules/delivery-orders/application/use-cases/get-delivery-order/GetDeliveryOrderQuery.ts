import { z } from 'zod';

import { DeliveryOrderValidationError } from '../../../domain/errors/DeliveryOrderError.js';

/**
 * External input contract for reading one delivery order.
 *
 * `organizationId` comes from the authenticated request context in the future
 * HTTP adapter. The use case still checks the loaded aggregate against it, so a
 * mismatched or forged scope cannot read another tenant's order.
 */
export const getDeliveryOrderQuerySchema = z.strictObject({
  organizationId: z.uuid(),
  orderId: z.uuid(),
});

export type GetDeliveryOrderQuery = z.infer<typeof getDeliveryOrderQuerySchema>;

export function parseGetDeliveryOrderQuery(input: unknown): GetDeliveryOrderQuery {
  const result = getDeliveryOrderQuerySchema.safeParse(input);

  if (!result.success) {
    throw new DeliveryOrderValidationError('Get delivery order query is invalid', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map((segment) => String(segment)).join('.'),
        message: issue.message,
      })),
    });
  }

  return result.data;
}
