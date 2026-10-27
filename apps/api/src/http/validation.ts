import type { ZodError, ZodType } from 'zod';

import { DeliveryOrderValidationError } from '../modules/delivery-orders/domain/errors/DeliveryOrderError.js';
import { IdentityValidationError } from '../modules/identity-and-access/domain/errors/IdentityError.js';

/**
 * Parses untrusted HTTP input with the application's own schema.
 *
 * Routes reuse the command/query schemas instead of duplicating shapes, so the
 * HTTP boundary and the use case cannot drift. Failures become the module's
 * typed validation error, which the central middleware maps to 400 with
 * field paths.
 */
export function parseOrThrow<T>(
  schema: ZodType<T>,
  input: unknown,
  message: string,
): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw toDeliveryOrderValidationError(message, result.error);
  }

  return result.data;
}

/**
 * Same contract as {@link parseOrThrow} for identity commands.
 *
 * The two modules own distinct typed errors (`DELIVERY_ORDER_INVALID_INPUT` vs
 * `IDENTITY_INVALID_INPUT`), so HTTP adapters pick the helper matching the use
 * case they call instead of re-mapping codes by hand.
 */
export function parseIdentityOrThrow<T>(
  schema: ZodType<T>,
  input: unknown,
  message: string,
): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw toIdentityValidationError(message, result.error);
  }

  return result.data;
}

function toDeliveryOrderValidationError(
  message: string,
  error: ZodError,
): DeliveryOrderValidationError {
  return new DeliveryOrderValidationError(message, {
    issues: toIssues(error),
  });
}

function toIdentityValidationError(
  message: string,
  error: ZodError,
): IdentityValidationError {
  return new IdentityValidationError(message, {
    issues: toIssues(error),
  });
}

function toIssues(
  error: ZodError,
): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    message: issue.message,
  }));
}
