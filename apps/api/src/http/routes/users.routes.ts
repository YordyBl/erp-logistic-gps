import type { RequestHandler } from 'express';
import { Router } from 'express';

import type { CreateUserUseCase } from '../../modules/identity-and-access/application/use-cases/create-user/CreateUserUseCase.js';
import { createUserCommandSchema } from '../../modules/identity-and-access/application/use-cases/create-user/CreateUserCommand.js';
import type { ListUsersUseCase } from '../../modules/identity-and-access/application/use-cases/list-users/ListUsersUseCase.js';
import {
  resetUserPasswordBodySchema,
  type ResetUserPasswordUseCase,
} from '../../modules/identity-and-access/application/use-cases/reset-user-password/ResetUserPasswordUseCase.js';
import {
  updateUserBodySchema,
  type UpdateUserUseCase,
} from '../../modules/identity-and-access/application/use-cases/update-user/UpdateUserUseCase.js';
import { getAuthenticatedUser } from '../request-context.js';
import { requireRole } from '../middleware/require-role.js';
import { parseIdentityOrThrow } from '../validation.js';

/**
 * Body shape accepted by the provisioning route.
 *
 * `organizationId` and `actorUserId` are removed so a caller cannot choose a
 * tenant or impersonate another actor: both come from the verified session.
 * The omitted strict object still rejects them as unknown properties.
 */
const createUserBodySchema = createUserCommandSchema.omit({
  organizationId: true,
  actorUserId: true,
});

/** Catalog driver linked to an account, as shown in the users table. */
export interface LinkedDriver {
  readonly id: string;
  readonly fullName: string;
}

/**
 * Driver links of an organization, keyed by user id. Provided by the drivers
 * module through the composition root; identity never reads its tables.
 */
export interface DriverLinksPort {
  linkedDrivers(organizationId: string): Promise<ReadonlyMap<string, LinkedDriver>>;
}

export interface UsersRouterDependencies {
  readonly createUser: CreateUserUseCase;
  readonly listUsers: ListUsersUseCase;
  readonly updateUser: UpdateUserUseCase;
  readonly resetUserPassword: ResetUserPasswordUseCase;
  readonly driverLinks: DriverLinksPort;
}

/**
 * User administration routes, ADMIN only.
 *
 * The actor identity is read from the request context populated by the JWT
 * middleware; each use case re-checks the actor and organization against
 * storage before reading or writing, so these routes cannot cross tenants.
 */
export function createUsersRouter(
  dependencies: UsersRouterDependencies,
  authenticate: RequestHandler,
): Router {
  const router = Router();

  router.use(authenticate, requireRole('ADMIN'));

  router.get('/', async (_request, response) => {
    // `authenticate` throws 401 without a verified caller, so the actor is present.
    const actor = getAuthenticatedUser(response)!;
    const [result, links] = await Promise.all([
      dependencies.listUsers.execute({ organizationId: actor.organizationId, actorUserId: actor.id }),
      dependencies.driverLinks.linkedDrivers(actor.organizationId),
    ]);

    response.status(200).json({
      data: result.users.map((user) => ({ ...user, driver: links.get(user.id) ?? null })),
    });
  });

  router.post('/', async (request, response) => {
    const body = parseIdentityOrThrow(
      createUserBodySchema,
      request.body,
      'Create user request body is invalid',
    );
    const actor = getAuthenticatedUser(response)!;

    const result = await dependencies.createUser.execute({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      ...body,
    });

    response.status(201).json({ data: result.user });
  });

  router.patch('/:userId', async (request, response) => {
    const changes = parseIdentityOrThrow(
      updateUserBodySchema,
      request.body,
      'Update user request body is invalid',
    );
    const actor = getAuthenticatedUser(response)!;

    const result = await dependencies.updateUser.execute({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      userId: request.params.userId,
      changes,
    });

    response.status(200).json({ data: result.user });
  });

  router.put('/:userId/password', async (request, response) => {
    const body = parseIdentityOrThrow(
      resetUserPasswordBodySchema,
      request.body,
      'Reset password request body is invalid',
    );
    const actor = getAuthenticatedUser(response)!;

    await dependencies.resetUserPassword.execute({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      userId: request.params.userId,
      password: body.password,
    });

    response.status(204).end();
  });

  return router;
}
