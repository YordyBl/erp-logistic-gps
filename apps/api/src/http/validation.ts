import type { ZodError, ZodType } from 'zod';

import { DeliveryOrderValidationError } from '../modules/delivery-orders/domain/errors/DeliveryOrderError.js';

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
    throw toValidationError(message, result.error);
  }

  return result.data;
}

function toValidationError(
  message: string,
  error: ZodError,
): DeliveryOrderValidationError {
  return new DeliveryOrderValidationError(message, {
    issues: error.issues.map((issue) => ({
      path: issue.path.map((segment) => String(segment)).join('.'),
      message: issue.message,
    })),
  });
}
