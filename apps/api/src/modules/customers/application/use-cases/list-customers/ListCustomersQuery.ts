import { z } from 'zod';

import { toCustomerValidationError } from '../../validation.js';

/** Tenant scope of the customer list, always supplied by the request context. */
export const listCustomersQuerySchema = z.strictObject({
  organizationId: z.uuid(),
});

export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

export function parseListCustomersQuery(input: unknown): ListCustomersQuery {
  const result = listCustomersQuerySchema.safeParse(input);

  if (!result.success) {
    throw toCustomerValidationError(result.error, 'List customers query is invalid');
  }

  return result.data;
}
