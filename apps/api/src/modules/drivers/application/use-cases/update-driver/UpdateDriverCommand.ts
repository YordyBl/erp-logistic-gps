import { z } from 'zod';

import {
  driverCodeSchema,
  driverPhoneSchema,
  driverStatusSchema,
  driverTextSchema,
  toDriverValidationError,
} from '../../validation.js';

/**
 * Mutable driver attributes accepted by the update route.
 *
 * The document number and the tenant are not editable: changing the identity
 * document needs an identity-verification workflow, not a catalog patch.
 */
const updateDriverFields = {
  fullName: driverTextSchema('fullName', 2, 120).optional(),
  phone: driverPhoneSchema.optional(),
  licenseNumber: driverCodeSchema('licenseNumber', 4, 40).optional(),
  status: driverStatusSchema.optional(),
};

type UpdateDriverFields = {
  readonly fullName?: string | undefined;
  readonly phone?: string | undefined;
  readonly licenseNumber?: string | undefined;
  readonly status?: string | undefined;
};

function hasAtLeastOneChange(value: UpdateDriverFields): boolean {
  return (
    value.fullName !== undefined ||
    value.phone !== undefined ||
    value.licenseNumber !== undefined ||
    value.status !== undefined
  );
}

const AT_LEAST_ONE_MESSAGE = 'At least one driver field must be provided';

/** Body accepted by `PATCH /api/v1/drivers/{driverId}`. */
export const updateDriverBodySchema = z
  .strictObject(updateDriverFields)
  .refine(hasAtLeastOneChange, { message: AT_LEAST_ONE_MESSAGE });

/** Full command, including the tenant and identifier supplied by the route. */
export const updateDriverCommandSchema = z
  .strictObject({
    organizationId: z.uuid(),
    driverId: z.uuid(),
    ...updateDriverFields,
  })
  .refine(hasAtLeastOneChange, { message: AT_LEAST_ONE_MESSAGE });

export type UpdateDriverCommand = z.infer<typeof updateDriverCommandSchema>;

export function parseUpdateDriverCommand(input: unknown): UpdateDriverCommand {
  const result = updateDriverCommandSchema.safeParse(input);

  if (!result.success) {
    throw toDriverValidationError(result.error, 'Update driver command is invalid');
  }

  return result.data;
}
