import type { RequestHandler } from 'express';
import { Router } from 'express';

import { createDriverCommandSchema } from '../../modules/drivers/application/use-cases/create-driver/CreateDriverCommand.js';
import type { CreateDriverUseCase } from '../../modules/drivers/application/use-cases/create-driver/CreateDriverUseCase.js';
import type { GetDriverUseCase } from '../../modules/drivers/application/use-cases/get-driver/GetDriverUseCase.js';
import type { ListDriversUseCase } from '../../modules/drivers/application/use-cases/list-drivers/ListDriversUseCase.js';
import { updateDriverBodySchema } from '../../modules/drivers/application/use-cases/update-driver/UpdateDriverCommand.js';
import type { UpdateDriverUseCase } from '../../modules/drivers/application/use-cases/update-driver/UpdateDriverUseCase.js';
import { requireOrganizationId } from '../middleware/organization-resolver.js';
import { requireRole } from '../middleware/require-role.js';
import { parseDriverOrThrow } from '../validation.js';

/**
 * HTTP adapters for the driver catalog.
 *
 * Reads are available to every authenticated role (a DRIVER may read the
 * catalog); writes require ADMIN or DISPATCHER. The tenant is read only from the
 * verified JWT context.
 */
export interface DriversHttpPorts {
  readonly createDriver: CreateDriverUseCase;
  readonly listDrivers: ListDriversUseCase;
  readonly getDriver: GetDriverUseCase;
  readonly updateDriver: UpdateDriverUseCase;
}

const createDriverBodySchema = createDriverCommandSchema.omit({
  organizationId: true,
});

export function createDriversRouter(
  ports: DriversHttpPorts,
  authenticate: RequestHandler,
): Router {
  const router = Router();

  router.use(authenticate);

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

  router.get('/:driverId', async (request, response) => {
    const result = await ports.getDriver.execute({
      organizationId: requireOrganizationId(response),
      driverId: request.params.driverId,
    });

    response.status(200).json({ data: result.driver });
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
