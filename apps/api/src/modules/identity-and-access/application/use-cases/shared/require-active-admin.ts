import type { User } from '../../../domain/entities/User.js';
import { ForbiddenRoleError, UserNotFoundError } from '../../../domain/errors/IdentityError.js';
import type { UserRepository } from '../../ports/UserRepository.js';

/**
 * Re-checks the actor from storage, never from a token claim (ADR-003 §2).
 *
 * An unknown, cross-organization or disabled actor is reported as not found,
 * so the response cannot confirm another tenant's user (ADR-003 §6).
 */
export async function requireActiveAdmin(
  users: UserRepository,
  actorUserId: string,
  organizationId: string,
): Promise<User> {
  const actor = await users.findById(actorUserId);

  if (actor === null || actor.organizationId !== organizationId || actor.status !== 'active') {
    throw new UserNotFoundError(actorUserId);
  }

  if (actor.role !== 'ADMIN') {
    throw new ForbiddenRoleError('ADMIN', actor.role);
  }

  return actor;
}

/** Loads a user of the same organization; another tenant's user is not found. */
export async function requireTenantUser(
  users: UserRepository,
  userId: string,
  organizationId: string,
): Promise<User> {
  const user = await users.findById(userId);

  if (user === null || user.organizationId !== organizationId) {
    throw new UserNotFoundError(userId);
  }

  return user;
}
