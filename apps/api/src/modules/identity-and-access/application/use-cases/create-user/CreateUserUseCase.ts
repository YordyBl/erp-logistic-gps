import { normalizeEmail, User } from '../../../domain/entities/User.js';
import {
  EmailAlreadyInUseError,
  ForbiddenRoleError,
  OrganizationNotFoundError,
  UserNotFoundError,
} from '../../../domain/errors/IdentityError.js';
import { toUserDto } from '../../dto/IdentityDto.js';
import type { Clock } from '../../ports/Clock.js';
import type { IdGenerator } from '../../ports/IdGenerator.js';
import type { OrganizationRepository } from '../../ports/OrganizationRepository.js';
import type { PasswordHasher } from '../../ports/PasswordHasher.js';
import type { UserRepository } from '../../ports/UserRepository.js';
import { parseCreateUserCommand } from './CreateUserCommand.js';
import type { CreateUserResult } from './CreateUserResult.js';

export interface CreateUserDependencies {
  readonly users: UserRepository;
  readonly organizations: OrganizationRepository;
  readonly passwordHasher: PasswordHasher;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Provisions a user inside the ADMIN's organization.
 *
 * Authorization is re-checked from storage, not trusted from a token claim:
 * the actor must exist, belong to the requested organization and hold ADMIN.
 * A cross-organization or unknown actor is reported as not found so the
 * response cannot confirm the existence of another tenant's user (ADR-003 §6).
 *
 * The temporary password is chosen by the ADMIN and hashed with Argon2id; it is
 * never stored or returned in plaintext.
 */
export class CreateUserUseCase {
  constructor(private readonly dependencies: CreateUserDependencies) {}

  async execute(input: unknown): Promise<CreateUserResult> {
    const command = parseCreateUserCommand(input);

    const actor = await this.dependencies.users.findById(command.actorUserId);

    if (actor === null || actor.organizationId !== command.organizationId) {
      throw new UserNotFoundError(command.actorUserId);
    }

    if (actor.role !== 'ADMIN') {
      throw new ForbiddenRoleError('ADMIN', actor.role);
    }

    const organization = await this.dependencies.organizations.findById(
      command.organizationId,
    );

    if (organization === null) {
      throw new OrganizationNotFoundError(command.organizationId);
    }

    const email = normalizeEmail(command.email);
    const existing = await this.dependencies.users.findByEmail(
      command.organizationId,
      email,
    );

    if (existing !== null) {
      throw new EmailAlreadyInUseError(command.organizationId);
    }

    const passwordHash = await this.dependencies.passwordHasher.hash(
      command.password,
    );

    const user = User.create({
      id: this.dependencies.idGenerator.nextId(),
      organizationId: command.organizationId,
      email,
      passwordHash,
      role: command.role,
      status: 'active',
      createdAt: this.dependencies.clock.now(),
    });

    await this.dependencies.users.save(user);

    return { user: toUserDto(user) };
  }
}
