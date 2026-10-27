import { z, type ZodError } from 'zod';

import {
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_EMAIL_PATTERN,
  CUSTOMER_CODE_PATTERN,
  CUSTOMER_STATUSES,
} from '../domain/entities/Customer.js';
import { CustomerValidationError } from '../domain/errors/CustomerError.js';

/**
 * Shared command fragments for the customer catalog.
 *
 * Normalization and validation live here as well as in the domain entity: this
 * is the application boundary (ADR-001 rule 8), and the entity re-checks so a
 * row written by an adapter cannot bypass the invariant.
 */
export const customerCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .min(3)
      .max(32)
      .regex(
        CUSTOMER_CODE_PATTERN,
        'publicCode must contain letters, digits and separating hyphens',
      ),
  );

export const customerStatusSchema = z.enum(CUSTOMER_STATUSES);

export const contactEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .min(3)
      .max(CONTACT_EMAIL_MAX_LENGTH)
      .regex(CONTACT_EMAIL_PATTERN, 'contactEmail must be a valid address'),
  );

export const contactPhoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(32)
  .regex(
    /^\+?[0-9][0-9 ()-]*$/,
    'contactPhone may contain digits, spaces, parentheses, hyphens and an optional leading +',
  );

/** Converts a Zod failure into the module's typed boundary error. */
export function toCustomerValidationError(
  error: ZodError,
  message: string,
): CustomerValidationError {
  return new CustomerValidationError(message, {
    issues: error.issues.map((issue) => ({
      path: issue.path.map((segment) => String(segment)).join('.'),
      message: issue.message,
    })),
  });
}
