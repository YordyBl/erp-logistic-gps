import { z } from 'zod';

import {
  toVehicleValidationError,
  vehicleCapacitySchema,
  vehicleStatusSchema,
  vehicleTypeSchema,
} from '../../validation.js';

/**
 * Mutable vehicle attributes accepted by the update route.
 *
 * The plate and the tenant are not editable. An explicit `capacityKg: null`
 * clears the capacity; omitting the field leaves it untouched.
 */
const updateVehicleFields = {
  type: vehicleTypeSchema.optional(),
  capacityKg: vehicleCapacitySchema.optional(),
  status: vehicleStatusSchema.optional(),
};

type UpdateVehicleFields = {
  readonly type?: string | undefined;
  readonly capacityKg?: number | null | undefined;
  readonly status?: string | undefined;
};

function hasAtLeastOneChange(value: UpdateVehicleFields): boolean {
  return (
    value.type !== undefined ||
    value.capacityKg !== undefined ||
    value.status !== undefined
  );
}

const AT_LEAST_ONE_MESSAGE = 'At least one vehicle field must be provided';

/** Body accepted by `PATCH /api/v1/vehicles/{vehicleId}`. */
export const updateVehicleBodySchema = z
  .strictObject(updateVehicleFields)
  .refine(hasAtLeastOneChange, { message: AT_LEAST_ONE_MESSAGE });

/** Full command, including the tenant and identifier supplied by the route. */
export const updateVehicleCommandSchema = z
  .strictObject({
    organizationId: z.uuid(),
    vehicleId: z.uuid(),
    ...updateVehicleFields,
  })
  .refine(hasAtLeastOneChange, { message: AT_LEAST_ONE_MESSAGE });

export type UpdateVehicleCommand = z.infer<typeof updateVehicleCommandSchema>;

export function parseUpdateVehicleCommand(input: unknown): UpdateVehicleCommand {
  const result = updateVehicleCommandSchema.safeParse(input);

  if (!result.success) {
    throw toVehicleValidationError(result.error, 'Update vehicle command is invalid');
  }

  return result.data;
}
