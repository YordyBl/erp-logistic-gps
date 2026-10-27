import type { DataSource } from 'typeorm';

import type { UserRepository } from '../../application/ports/UserRepository.js';
import type { User } from '../../domain/entities/User.js';
import { EmailAlreadyInUseError } from '../../domain/errors/IdentityError.js';
import { UserEntity } from './entities/UserEntity.js';
import { toUserDomain, toUserEntity } from './mappers/UserMapper.js';
import { readPostgresDriverError, toError } from './postgres-error.js';

/**
 * PostgreSQL adapter for the {@link UserRepository} port.
 *
 * `uq_users_organization_email` is translated into `EmailAlreadyInUseError`, so
 * a concurrent duplicate create returns the same typed conflict the use-case
 * pre-check raises. Emails are compared exactly; the domain stores them
 * lowercased, so case variants collide as intended.
 */
export class UserTypeOrmRepository implements UserRepository {
  constructor(private readonly dataSource: DataSource) {}

  async save(user: User): Promise<void> {
    try {
      await this.dataSource.getRepository(UserEntity).save(toUserEntity(user));
    } catch (error) {
      throw translateUserPersistenceError(error, user);
    }
  }

  async findById(userId: string): Promise<User | null> {
    const entity = await this.dataSource
      .getRepository(UserEntity)
      .findOne({ where: { id: userId } });

    return entity === null ? null : toUserDomain(entity);
  }

  async findByEmail(organizationId: string, email: string): Promise<User | null> {
    const entity = await this.dataSource
      .getRepository(UserEntity)
      .findOne({ where: { organizationId, email } });

    return entity === null ? null : toUserDomain(entity);
  }
}

function translateUserPersistenceError(error: unknown, user: User): Error {
  const driverError = readPostgresDriverError(error);

  if (
    driverError?.code === '23505' &&
    driverError.constraint === 'uq_users_organization_email'
  ) {
    return new EmailAlreadyInUseError(user.organizationId);
  }

  return toError(error);
}
