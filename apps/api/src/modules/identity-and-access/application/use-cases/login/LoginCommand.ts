import { z } from 'zod';

import { emailSchema, toIdentityValidationError } from '../../validation.js';

/**
 * Login command.
 *
 * `organizationId` is required because emails are unique per organization, not
 * globally. The HTTP adapter (T2) resolves it from the tenant context and never
 * from the request body's own claims.
 */
export const loginCommandSchema = z.strictObject({
  organizationId: z.uuid(),
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export type LoginCommand = z.infer<typeof loginCommandSchema>;

export function parseLoginCommand(input: unknown): LoginCommand {
  const result = loginCommandSchema.safeParse(input);

  if (!result.success) {
    throw toIdentityValidationError(result.error, 'Login command is invalid');
  }

  return result.data;
}
