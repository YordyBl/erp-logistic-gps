import {
  isUserRole,
  isUserStatus,
  User,
} from '../../../domain/entities/User.js';
import { UserEntity } from '../entities/UserEntity.js';

/**
 * Explicit domain ⇄ TypeORM mapping for users.
 *
 * A corrupted role or status in the database fails loudly instead of being
 * coerced into a valid-looking value, so authorization never runs on a guess.
 */
export function toUserEntity(user: User): UserEntity {
  const entity = new UserEntity();

  entity.id = user.id;
  entity.organizationId = user.organizationId;
  entity.email = user.email;
  entity.passwordHash = user.passwordHash;
  entity.role = user.role;
  entity.status = user.status;
  entity.createdAt = new Date(user.createdAt);

  return entity;
}

export function toUserDomain(entity: UserEntity): User {
  if (!isUserRole(entity.role)) {
    throw new Error(`Persisted user ${entity.id} has invalid role "${entity.role}"`);
  }

  if (!isUserStatus(entity.status)) {
    throw new Error(`Persisted user ${entity.id} has invalid status "${entity.status}"`);
  }

  return User.create({
    id: entity.id,
    organizationId: entity.organizationId,
    email: entity.email,
    passwordHash: entity.passwordHash,
    role: entity.role,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
  });
}
