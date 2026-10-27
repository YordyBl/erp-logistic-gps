import { z, type ZodError } from 'zod';

import {
  DRIVER_CODE_PATTERN,
  DRIVER_STATUSES,
} from '../domain/entities/Driver.js';
import { DriverValidationError } from '../domain/errors/DriverError.js';

/**
 * Shared command fragments for the driver catalog.
 *
 * Normalization and validation live here as well as in the domain entity: this
 * is the application boundary (ADR-001 rule 8), and the entity re-checks so a
 * row written by an adapter cannot bypass the invariant.
 */
export function driverCodeSchema(
  field: string,
  minLength: number,
  maxLength: number,
): z.ZodType<string> {
  return z
    .string()
    .trim()
    .toUpperCase()
    .pipe(
      z
        .string()
        .min(minLength)
        .max(maxLength)
        .regex(
          DRIVER_CODE_PATTERN,
          `${field} must contain letters, digits and separating hyphens`,
        ),
    );
}

export function driverTextSchema(
  field: string,
  minLength: number,
  maxLength: number,
): z.ZodType<string> {
  return z
    .string()
    .trim()
    .min(minLength, `${field} must contain at least ${minLength} characters`)
    .max(maxLength, `${field} must contain at most ${maxLength} characters`);
}

export const driverPhoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(32)
  .regex(
    /^\+?[0-9][0-9 ()-]*$/,
    'phone may contain digits, spaces, parentheses, hyphens and an optional leading +',
  );

export const driverStatusSchema = z.enum(DRIVER_STATUSES);

/** Converts a Zod failure into the module's typed boundary error. */
export function toDriverValidationError(
  error: ZodError,
  message: string,
): DriverValidationError {
  return new DriverValidationError(message, {
    issues: error.issues.map((issue) => ({
      path: issue.path.map((segment) => String(segment)).join('.'),
      message: issue.message,
    })),
  });
}
