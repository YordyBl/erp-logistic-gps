import { z } from 'zod';

import { toVehicleValidationError } from '../../validation.js';

/** Tenant and identifier of one vehicle read. */
export const getVehicleQuerySchema = z.strictObject({
  organizationId: z.uuid(),
  vehicleId: z.uuid(),
});

export type GetVehicleQuery = z.infer<typeof getVehicleQuerySchema>;

export function parseGetVehicleQuery(input: unknown): GetVehicleQuery {
  const result = getVehicleQuerySchema.safeParse(input);

  if (!result.success) {
    throw toVehicleValidationError(result.error, 'Get vehicle query is invalid');
  }

  return result.data;
}
