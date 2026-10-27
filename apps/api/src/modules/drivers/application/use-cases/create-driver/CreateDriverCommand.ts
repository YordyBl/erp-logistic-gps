import { z } from 'zod';

import {
  driverCodeSchema,
  driverPhoneSchema,
  driverStatusSchema,
  driverTextSchema,
  toDriverValidationError,
} from '../../validation.js';

/**
 * External input contract for creating a driver.
 *
 * `organizationId` comes from the authenticated request context, never from a
 * request body.
 */
export const createDriverCommandSchema = z.strictObject({
  organizationId: z.uuid(),
  fullName: driverTextSchema('fullName', 2, 120),
  documentNumber: driverCodeSchema('documentNumber', 6, 20),
  phone: driverPhoneSchema,
  licenseNumber: driverCodeSchema('licenseNumber', 4, 40),
  status: driverStatusSchema.default('active'),
});

export type CreateDriverCommand = z.infer<typeof createDriverCommandSchema>;

export function parseCreateDriverCommand(input: unknown): CreateDriverCommand {
  const result = createDriverCommandSchema.safeParse(input);

  if (!result.success) {
    throw toDriverValidationError(result.error, 'Create driver command is invalid');
  }

  return result.data;
}
