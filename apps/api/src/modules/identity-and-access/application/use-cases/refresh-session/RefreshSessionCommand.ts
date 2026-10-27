import { z } from 'zod';

import { refreshTokenSchema, toIdentityValidationError } from '../../validation.js';

/**
 * Rotation command: the raw refresh token read from the HttpOnly cookie.
 *
 * It is validated as an opaque string only; a malformed value simply fails the
 * hash lookup and is reported as not found.
 */
export const refreshSessionCommandSchema = z.strictObject({
  refreshToken: refreshTokenSchema,
});

export type RefreshSessionCommand = z.infer<typeof refreshSessionCommandSchema>;

export function parseRefreshSessionCommand(
  input: unknown,
): RefreshSessionCommand {
  const result = refreshSessionCommandSchema.safeParse(input);

  if (!result.success) {
    throw toIdentityValidationError(result.error, 'Refresh session command is invalid');
  }

  return result.data;
}
