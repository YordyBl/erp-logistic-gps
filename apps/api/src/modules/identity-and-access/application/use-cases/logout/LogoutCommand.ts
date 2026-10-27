import { z } from 'zod';

import { refreshTokenSchema, toIdentityValidationError } from '../../validation.js';

export const logoutCommandSchema = z.strictObject({
  refreshToken: refreshTokenSchema,
});

export type LogoutCommand = z.infer<typeof logoutCommandSchema>;

export function parseLogoutCommand(input: unknown): LogoutCommand {
  const result = logoutCommandSchema.safeParse(input);

  if (!result.success) {
    throw toIdentityValidationError(result.error, 'Logout command is invalid');
  }

  return result.data;
}
