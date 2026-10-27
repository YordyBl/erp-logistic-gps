import type { RequestHandler } from 'express';
import { Router } from 'express';

import { createVehicleCommandSchema } from '../../modules/vehicles/application/use-cases/create-vehicle/CreateVehicleCommand.js';
import type { CreateVehicleUseCase } from '../../modules/vehicles/application/use-cases/create-vehicle/CreateVehicleUseCase.js';
import type { GetVehicleUseCase } from '../../modules/vehicles/application/use-cases/get-vehicle/GetVehicleUseCase.js';
import type { ListVehiclesUseCase } from '../../modules/vehicles/application/use-cases/list-vehicles/ListVehiclesUseCase.js';
import { updateVehicleBodySchema } from '../../modules/vehicles/application/use-cases/update-vehicle/UpdateVehicleCommand.js';
import type { UpdateVehicleUseCase } from '../../modules/vehicles/application/use-cases/update-vehicle/UpdateVehicleUseCase.js';
import { requireOrganizationId } from '../middleware/organization-resolver.js';
import { requireRole } from '../middleware/require-role.js';
import { parseVehicleOrThrow } from '../validation.js';

/**
 * HTTP adapters for the vehicle catalog.
 *
 * Reads are available to every authenticated role (a DRIVER may read the
 * fleet); writes require ADMIN or DISPATCHER. The tenant is read only from the
 * verified JWT context.
 */
export interface VehiclesHttpPorts {
  readonly createVehicle: CreateVehicleUseCase;
  readonly listVehicles: ListVehiclesUseCase;
  readonly getVehicle: GetVehicleUseCase;
  readonly updateVehicle: UpdateVehicleUseCase;
}

const createVehicleBodySchema = createVehicleCommandSchema.omit({
  organizationId: true,
});

export function createVehiclesRouter(
  ports: VehiclesHttpPorts,
  authenticate: RequestHandler,
): Router {
  const router = Router();

  router.use(authenticate);

  router.post('/', requireRole('ADMIN', 'DISPATCHER'), async (request, response) => {
    const body = parseVehicleOrThrow(
      createVehicleBodySchema,
      request.body,
      'Create vehicle request body is invalid',
    );

    const result = await ports.createVehicle.execute({
      organizationId: requireOrganizationId(response),
      ...body,
    });

    response
      .status(201)
      .location(`/api/v1/vehicles/${result.vehicle.id}`)
      .json({ data: result.vehicle });
  });

  router.get('/', async (_request, response) => {
    const result = await ports.listVehicles.execute({
      organizationId: requireOrganizationId(response),
    });

    response.status(200).json({ data: result.vehicles });
  });

  router.get('/:vehicleId', async (request, response) => {
    const result = await ports.getVehicle.execute({
      organizationId: requireOrganizationId(response),
      vehicleId: request.params.vehicleId,
    });

    response.status(200).json({ data: result.vehicle });
  });

  router.patch(
    '/:vehicleId',
    requireRole('ADMIN', 'DISPATCHER'),
    async (request, response) => {
      const body = parseVehicleOrThrow(
        updateVehicleBodySchema,
        request.body,
        'Update vehicle request body is invalid',
      );

      const result = await ports.updateVehicle.execute({
        organizationId: requireOrganizationId(response),
        vehicleId: request.params.vehicleId,
        ...body,
      });

      response.status(200).json({ data: result.vehicle });
    },
  );

  return router;
}
