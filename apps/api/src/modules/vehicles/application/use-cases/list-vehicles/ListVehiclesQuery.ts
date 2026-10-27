import { z } from 'zod';

import { toVehicleValidationError } from '../../validation.js';

/** Tenant scope of the vehicle list, always supplied by the request context. */
export const listVehiclesQuerySchema = z.strictObject({
  organizationId: z.uuid(),
});

export type ListVehiclesQuery = z.infer<typeof listVehiclesQuerySchema>;

export function parseListVehiclesQuery(input: unknown): ListVehiclesQuery {
  const result = listVehiclesQuerySchema.safeParse(input);

  if (!result.success) {
    throw toVehicleValidationError(result.error, 'List vehicles query is invalid');
  }

  return result.data;
}
