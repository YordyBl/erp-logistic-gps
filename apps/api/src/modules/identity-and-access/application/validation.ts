import { z, type ZodError } from 'zod';

import { EMAIL_MAX_LENGTH, EMAIL_PATTERN } from '../domain/entities/User.js';
import { IdentityValidationError } from '../domain/errors/IdentityError.js';

/**
 * Shared command fragments.
 *
 * Email format and the refresh-token shape are validated identically in every
 * slice; the password policy is enforced by `assertPasswordPolicy` so it can
 * raise the dedicated typed error instead of a generic validation error.
 */
export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(EMAIL_MAX_LENGTH)
  .regex(EMAIL_PATTERN, 'email must be a valid address');

export const refreshTokenSchema = z.string().min(1).max(512);

/** Converts a Zod failure into the module's typed boundary error. */
export function toIdentityValidationError(
  error: ZodError,
  message: string,
): IdentityValidationError {
  return new IdentityValidationError(message, {
    issues: error.issues.map((issue) => ({
      path: issue.path.map((segment) => String(segment)).join('.'),
      message: issue.message,
    })),
  });
}
