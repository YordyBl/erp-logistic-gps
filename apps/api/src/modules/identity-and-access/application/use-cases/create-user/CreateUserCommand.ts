import { z } from 'zod';

import { USER_ROLES } from '../../../domain/entities/User.js';
import { assertPasswordPolicy } from '../../../domain/policies/password-policy.js';
import {
  emailSchema,
  toIdentityValidationError,
} from '../../validation.js';

/**
 * ADMIN-only user provisioning (architecture plan §11.2).
 *
 * There is no self-registration: `actorUserId` identifies the authenticated
 * ADMIN and is resolved against storage by the use case. `organizationId` comes
 * from the request context, never from a request body.
 */
export const createUserCommandSchema = z.strictObject({
  organizationId: z.uuid(),
  actorUserId: z.uuid(),
  email: emailSchema,
  password: z.string(),
  role: z.enum(USER_ROLES),
});

export type CreateUserCommand = z.infer<typeof createUserCommandSchema>;

/**
 * Parses untrusted input.
 *
 * The password policy runs at this boundary too, but raises the dedicated
 * `WeakPasswordError` with stable reason codes instead of a generic validation
 * error. The rejected password is never copied into the error.
 */
export function parseCreateUserCommand(input: unknown): CreateUserCommand {
  const result = createUserCommandSchema.safeParse(input);

  if (!result.success) {
    throw toIdentityValidationError(result.error, 'Create user command is invalid');
  }

  assertPasswordPolicy(result.data.password);

  return result.data;
}
