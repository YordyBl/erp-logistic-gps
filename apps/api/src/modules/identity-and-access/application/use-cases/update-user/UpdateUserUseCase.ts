import { z } from 'zod';

import { USER_ROLES, USER_STATUSES } from '../../../domain/entities/User.js';
import {
  DriverAccountLinkedError,
  SelfChangeForbiddenError,
} from '../../../domain/errors/IdentityError.js';
import { toUserDto, type UserDto } from '../../dto/IdentityDto.js';
import type { Clock } from '../../ports/Clock.js';
import type { DriverAccountLookup } from '../../ports/DriverAccountLookup.js';
import type { RefreshTokenStore } from '../../ports/RefreshTokenStore.js';
import type { UserRepository } from '../../ports/UserRepository.js';
import {
  optionalNamePartSchema,
  requiredNamePartSchema,
  toIdentityValidationError,
} from '../../validation.js';
import { requireActiveAdmin, requireTenantUser } from '../shared/require-active-admin.js';

/**
 * Body of `PATCH /users/:id`. Any name field replaces the whole name, so
 * nombres and apellido paterno travel together; apellido materno may be null.
 */
export const updateUserBodySchema = z
  .strictObject({
    firstName: requiredNamePartSchema.optional(),
    paternalSurname: requiredNamePartSchema.optional(),
    maternalSurname: optionalNamePartSchema,
    role: z.enum(USER_ROLES).optional(),
    status: z.enum(USER_STATUSES).optional(),
  })
  .superRefine((body, context) => {
    const touchesName = body.firstName !== undefined || body.paternalSurname !== undefined;
    if (touchesName && (body.firstName === undefined || body.paternalSurname === undefined)) {
      context.addIssue({
        code: 'custom',
        path: [body.firstName === undefined ? 'firstName' : 'paternalSurname'],
        message: 'firstName and paternalSurname must be sent together',
      });
    }
    if (!touchesName && body.role === undefined && body.status === undefined) {
      context.addIssue({ code: 'custom', path: [], message: 'Nothing to update' });
    }
  });

const updateUserCommandSchema = z.strictObject({
  organizationId: z.uuid(),
  actorUserId: z.uuid(),
  userId: z.uuid(),
  changes: updateUserBodySchema,
});

export interface UpdateUserDependencies {
  readonly users: UserRepository;
  readonly refreshTokens: RefreshTokenStore;
  readonly driverAccounts: DriverAccountLookup;
  readonly clock: Clock;
}

export interface UpdateUserResult {
  readonly user: UserDto;
}

/**
 * ADMIN-only change of a user's name, role or status.
 *
 * Rules: an ADMIN never changes their own role nor disables themselves, which
 * also guarantees the organization keeps an active ADMIN (the actor itself);
 * a DRIVER account linked to a catalog driver keeps its role until unlinked. Disabling ends every
 * session of the account (the access token is already rejected because
 * authentication reloads the user on each request).
 */
export class UpdateUserUseCase {
  constructor(private readonly dependencies: UpdateUserDependencies) {}

  async execute(input: unknown): Promise<UpdateUserResult> {
    const parsed = updateUserCommandSchema.safeParse(input);
    if (!parsed.success) {
      throw toIdentityValidationError(parsed.error, 'Update user command is invalid');
    }
    const { organizationId, actorUserId, userId, changes } = parsed.data;
    const { users } = this.dependencies;

    await requireActiveAdmin(users, actorUserId, organizationId);
    const target = await requireTenantUser(users, userId, organizationId);

    const role = changes.role ?? target.role;
    const status = changes.status ?? target.status;
    const roleChanges = role !== target.role;
    const disables = status === 'disabled' && target.status !== 'disabled';

    if (target.id === actorUserId && (roleChanges || disables)) {
      throw new SelfChangeForbiddenError();
    }

    if (roleChanges && target.role === 'DRIVER' &&
        await this.dependencies.driverAccounts.isLinkedToDriver(organizationId, target.id)) {
      throw new DriverAccountLinkedError();
    }

    const updated = target.with({
      role,
      status,
      ...(changes.firstName === undefined || changes.paternalSurname === undefined
        ? {}
        : {
          name: {
            firstName: changes.firstName,
            paternalSurname: changes.paternalSurname,
            maternalSurname: changes.maternalSurname,
          },
        }),
    });

    await users.save(updated);
    if (disables) {
      await this.dependencies.refreshTokens.revokeAllForUser(target.id, this.dependencies.clock.now());
    }

    return { user: toUserDto(updated) };
  }
}
