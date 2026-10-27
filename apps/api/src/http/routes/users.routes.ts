import type { RequestHandler } from 'express';
import { Router } from 'express';

import type { CreateUserUseCase } from '../../modules/identity-and-access/application/use-cases/create-user/CreateUserUseCase.js';
import { createUserCommandSchema } from '../../modules/identity-and-access/application/use-cases/create-user/CreateUserCommand.js';
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

export interface UsersRouterDependencies {
  readonly createUser: CreateUserUseCase;
}

/**
 * User administration routes (S3: users are created only by an ADMIN).
 *
 * The actor identity is read from the request context populated by the JWT
 * middleware; the use case re-checks the actor and organization against storage
 * before writing, so this route cannot be used to cross tenant boundaries.
 */
export function createUsersRouter(
  dependencies: UsersRouterDependencies,
  authenticate: RequestHandler,
): Router {
  const router = Router();

  router.post('/', authenticate, requireRole('ADMIN'), async (request, response) => {
    const body = parseIdentityOrThrow(
      createUserBodySchema,
      request.body,
      'Create user request body is invalid',
    );

    // `authenticate` and `requireRole` run before this handler; the first one
    // throws 401 without a verified caller, so the actor is always present.
    const actor = getAuthenticatedUser(response)!;

    const result = await dependencies.createUser.execute({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      ...body,
    });

    response.status(201).json({ data: result.user });
  });

  return router;
}
