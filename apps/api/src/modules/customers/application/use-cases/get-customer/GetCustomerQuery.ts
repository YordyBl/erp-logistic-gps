import { z } from 'zod';

import { toCustomerValidationError } from '../../validation.js';

/** Tenant and identifier of one customer read. */
export const getCustomerQuerySchema = z.strictObject({
  organizationId: z.uuid(),
  customerId: z.uuid(),
});

export type GetCustomerQuery = z.infer<typeof getCustomerQuerySchema>;

export function parseGetCustomerQuery(input: unknown): GetCustomerQuery {
  const result = getCustomerQuerySchema.safeParse(input);

  if (!result.success) {
    throw toCustomerValidationError(result.error, 'Get customer query is invalid');
  }

  return result.data;
}
