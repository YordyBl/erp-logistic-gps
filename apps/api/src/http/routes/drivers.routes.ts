import type { RequestHandler } from 'express';
import { Router } from 'express';

import { createDriverCommandSchema } from '../../modules/drivers/application/use-cases/create-driver/CreateDriverCommand.js';
import type { CreateDriverUseCase } from '../../modules/drivers/application/use-cases/create-driver/CreateDriverUseCase.js';
import type { GetDriverUseCase } from '../../modules/drivers/application/use-cases/get-driver/GetDriverUseCase.js';
import type { ListDriversUseCase } from '../../modules/drivers/application/use-cases/list-drivers/ListDriversUseCase.js';
import { updateDriverBodySchema } from '../../modules/drivers/application/use-cases/update-driver/UpdateDriverCommand.js';
import type { UpdateDriverUseCase } from '../../modules/drivers/application/use-cases/update-driver/UpdateDriverUseCase.js';
import { bindDriverAccountBodySchema, type BindDriverAccountUseCase } from '../../modules/drivers/application/use-cases/bind-driver-account/BindDriverAccountUseCase.js';
import { requireOrganizationId } from '../middleware/organization-resolver.js';
import { requireRole } from '../middleware/require-role.js';
import { parseDriverOrThrow } from '../validation.js';
import { getAuthenticatedUser } from '../request-context.js';

/**
 * HTTP adapters for the driver catalog.
 *
 * Catalog access requires ADMIN or DISPATCHER; DRIVER accounts are limited to
 * assigned-route operations. Account selection and binding require ADMIN. The
 * tenant is read only from verified JWT context.
 */
export interface DriversHttpPorts {
  readonly createDriver: CreateDriverUseCase;
  readonly listDrivers: ListDriversUseCase;
  readonly getDriver: GetDriverUseCase;
  readonly updateDriver: UpdateDriverUseCase;
  readonly bindDriverAccount: BindDriverAccountUseCase;
}

const createDriverBodySchema = createDriverCommandSchema.omit({
  organizationId: true,
});

export function createDriversRouter(
  ports: DriversHttpPorts,
  authenticate: RequestHandler,
): Router {
  const router = Router();

  router.use(authenticate, requireRole('ADMIN', 'DISPATCHER'));

  router.post('/', requireRole('ADMIN', 'DISPATCHER'), async (request, response) => {
    const body = parseDriverOrThrow(
      createDriverBodySchema,
      request.body,
      'Create driver request body is invalid',
    );

    const result = await ports.createDriver.execute({
      organizationId: requireOrganizationId(response),
      ...body,
    });

    response
      .status(201)
      .location(`/api/v1/drivers/${result.driver.id}`)
      .json({ data: result.driver });
  });

  router.get('/', async (_request, response) => {
    const result = await ports.listDrivers.execute({
      organizationId: requireOrganizationId(response),
    });

    response.status(200).json({ data: result.drivers });
  });

  router.get('/accounts', requireRole('ADMIN'), async (_request, response) => {
    const result = await ports.bindDriverAccount.listAccounts(requireOrganizationId(response));
    response.status(200).json({ data: result.accounts });
  });

  router.get('/:driverId', async (request, response) => {
    const result = await ports.getDriver.execute({
      organizationId: requireOrganizationId(response),
      driverId: request.params.driverId,
    });

    response.status(200).json({ data: result.driver });
  });

  router.get('/:driverId/account', requireRole('ADMIN'), async (request, response) => {
    const result = await ports.bindDriverAccount.get(
      requireOrganizationId(response), request.params.driverId,
    );
    response.status(200).json({ data: result.binding });
  });

  router.put('/:driverId/account', requireRole('ADMIN'), async (request, response) => {
    const body = parseDriverOrThrow(bindDriverAccountBodySchema, request.body,
      'Bind driver account request body is invalid');
    const actor = getAuthenticatedUser(response);
    if (actor === undefined) throw new Error('Authenticated actor is required');
    const result = await ports.bindDriverAccount.execute({
      organizationId: requireOrganizationId(response),
      driverId: request.params.driverId, actorUserId: actor.id, ...body,
    });
    response.status(200).json({ data: result.binding });
  });

  router.patch(
    '/:driverId',
    requireRole('ADMIN', 'DISPATCHER'),
    async (request, response) => {
      const body = parseDriverOrThrow(
        updateDriverBodySchema,
        request.body,
        'Update driver request body is invalid',
      );

      const result = await ports.updateDriver.execute({
        organizationId: requireOrganizationId(response),
        driverId: request.params.driverId,
        ...body,
      });

      response.status(200).json({ data: result.driver });
    },
  );

  return router;
}
