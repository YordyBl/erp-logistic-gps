import { z } from 'zod';

import { assertPasswordPolicy } from '../../../domain/policies/password-policy.js';
import type { Clock } from '../../ports/Clock.js';
import type { PasswordHasher } from '../../ports/PasswordHasher.js';
import type { RefreshTokenStore } from '../../ports/RefreshTokenStore.js';
import type { UserRepository } from '../../ports/UserRepository.js';
import { toIdentityValidationError } from '../../validation.js';
import { requireActiveAdmin, requireTenantUser } from '../shared/require-active-admin.js';

/** Body of `PUT /users/:id/password`. */
export const resetUserPasswordBodySchema = z.strictObject({ password: z.string() });

const resetUserPasswordCommandSchema = resetUserPasswordBodySchema.extend({
  organizationId: z.uuid(),
  actorUserId: z.uuid(),
  userId: z.uuid(),
});

export interface ResetUserPasswordDependencies {
  readonly users: UserRepository;
  readonly passwordHasher: PasswordHasher;
  readonly refreshTokens: RefreshTokenStore;
  readonly clock: Clock;
}

/**
 * ADMIN sets a new temporary password for an account of the organization.
 *
 * There is no email flow: the ADMIN hands the password to the person. Every
 * session of the account ends, so a leaked old password cannot keep a device
 * signed in. The password is hashed with Argon2id and never returned.
 */
export class ResetUserPasswordUseCase {
  constructor(private readonly dependencies: ResetUserPasswordDependencies) {}

  async execute(input: unknown): Promise<void> {
    const parsed = resetUserPasswordCommandSchema.safeParse(input);
    if (!parsed.success) {
      throw toIdentityValidationError(parsed.error, 'Reset user password command is invalid');
    }
    const { organizationId, actorUserId, userId, password } = parsed.data;
    assertPasswordPolicy(password);

    await requireActiveAdmin(this.dependencies.users, actorUserId, organizationId);
    const target = await requireTenantUser(this.dependencies.users, userId, organizationId);

    const passwordHash = await this.dependencies.passwordHasher.hash(password);
    await this.dependencies.users.save(target.with({ passwordHash }));
    await this.dependencies.refreshTokens.revokeAllForUser(target.id, this.dependencies.clock.now());
  }
}
