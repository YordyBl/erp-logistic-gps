import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { createVehicleCommandSchema } from '../../modules/vehicles/application/use-cases/create-vehicle/CreateVehicleCommand.js';
import type { CreateVehicleUseCase } from '../../modules/vehicles/application/use-cases/create-vehicle/CreateVehicleUseCase.js';
import type { GetVehicleUseCase } from '../../modules/vehicles/application/use-cases/get-vehicle/GetVehicleUseCase.js';
import {
  VEHICLE_SORT_FIELDS,
  type VehiclePageCriteria,
} from '../../modules/vehicles/application/ports/VehicleRepository.js';
import type { ListVehiclesPageUseCase } from '../../modules/vehicles/application/use-cases/list-vehicles/ListVehiclesPageUseCase.js';
import type { ListVehiclesUseCase } from '../../modules/vehicles/application/use-cases/list-vehicles/ListVehiclesUseCase.js';
import { updateVehicleBodySchema } from '../../modules/vehicles/application/use-cases/update-vehicle/UpdateVehicleCommand.js';
import type { UpdateVehicleUseCase } from '../../modules/vehicles/application/use-cases/update-vehicle/UpdateVehicleUseCase.js';
import { VEHICLE_STATUSES } from '../../modules/vehicles/domain/entities/Vehicle.js';
import { requireOrganizationId } from '../middleware/organization-resolver.js';
import { requireRole } from '../middleware/require-role.js';
import { csvEnum, csvUuid, pageQueryShape, sortSchema, toPageResponse } from '../pagination.js';
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
  /** Whole fleet for selectors and plate lookups (`GET /vehicles/options`). */
  readonly listVehicles: ListVehiclesUseCase;
  readonly listVehiclesPage: ListVehiclesPageUseCase;
  readonly getVehicle: GetVehicleUseCase;
  readonly updateVehicle: UpdateVehicleUseCase;
}

const createVehicleBodySchema = createVehicleCommandSchema.omit({
  organizationId: true,
});

/**
 * Paginated fleet query (`GET /vehicles`). Unknown parameters are rejected; the
 * default sort is `plate:asc` because the fleet is browsed and picked by plate.
 */
const listVehiclesPageQuerySchema = z
  .strictObject({
    ...pageQueryShape,
    sort: sortSchema(VEHICLE_SORT_FIELDS, { field: 'plate', direction: 'asc' }),
    status: csvEnum(VEHICLE_STATUSES).optional(),
    ids: csvUuid().optional(),
  })
  .transform(({ page, pageSize, sort, q, status, ids }): VehiclePageCriteria => ({
    page,
    pageSize,
    sort,
    ...(q === undefined ? {} : { q }),
    ...(status === undefined ? {} : { status }),
    ...(ids === undefined ? {} : { ids }),
  }));

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

  router.get('/', async (request, response) => {
    const criteria = parseVehicleOrThrow(
      listVehiclesPageQuerySchema,
      request.query,
      'List vehicles query is invalid',
    );
    const result = await ports.listVehiclesPage.execute({
      organizationId: requireOrganizationId(response),
      criteria,
    });

    response.status(200).json(toPageResponse(result, criteria.page, criteria.pageSize));
  });

  // Before `/:vehicleId`, which would otherwise take `options` as an id.
  router.get('/options', async (_request, response) => {
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
