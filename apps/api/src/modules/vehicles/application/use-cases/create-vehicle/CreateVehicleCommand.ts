import { z } from 'zod';

import {
  toVehicleValidationError,
  vehicleCapacitySchema,
  vehiclePlateSchema,
  vehicleStatusSchema,
  vehicleTypeSchema,
} from '../../validation.js';

/**
 * External input contract for creating a vehicle.
 *
 * `organizationId` comes from the authenticated request context, never from a
 * request body.
 */
export const createVehicleCommandSchema = z.strictObject({
  organizationId: z.uuid(),
  plate: vehiclePlateSchema,
  type: vehicleTypeSchema,
  capacityKg: vehicleCapacitySchema.optional(),
  status: vehicleStatusSchema.default('active'),
});

export type CreateVehicleCommand = z.infer<typeof createVehicleCommandSchema>;

export function parseCreateVehicleCommand(input: unknown): CreateVehicleCommand {
  const result = createVehicleCommandSchema.safeParse(input);

  if (!result.success) {
    throw toVehicleValidationError(result.error, 'Create vehicle command is invalid');
  }

  return result.data;
}
