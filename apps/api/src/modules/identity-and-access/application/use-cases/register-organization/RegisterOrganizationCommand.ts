import { z } from 'zod';

import {
  ORGANIZATION_NAME_MAX_LENGTH,
  ORGANIZATION_NAME_MIN_LENGTH,
} from '../../../domain/entities/Organization.js';
import { toIdentityValidationError } from '../../validation.js';

/**
 * Bootstrap command: register a tenant before any user exists.
 *
 * This is not an authenticated endpoint and is intentionally not part of the
 * normal admin surface. It exists for first-organization setup and the demo
 * seed (architecture plan §11.2).
 */
export const registerOrganizationCommandSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(ORGANIZATION_NAME_MIN_LENGTH)
    .max(ORGANIZATION_NAME_MAX_LENGTH),
});

export type RegisterOrganizationCommand = z.infer<
  typeof registerOrganizationCommandSchema
>;

export function parseRegisterOrganizationCommand(
  input: unknown,
): RegisterOrganizationCommand {
  const result = registerOrganizationCommandSchema.safeParse(input);

  if (!result.success) {
    throw toIdentityValidationError(result.error, 'Register organization command is invalid');
  }

  return result.data;
}
