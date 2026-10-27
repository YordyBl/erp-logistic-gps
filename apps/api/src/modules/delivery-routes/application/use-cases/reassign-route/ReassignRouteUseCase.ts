import { z } from 'zod';

import type { GetDriverUseCase } from '../../../../drivers/application/use-cases/get-driver/GetDriverUseCase.js';
import type { GetVehicleUseCase } from '../../../../vehicles/application/use-cases/get-vehicle/GetVehicleUseCase.js';
import { DeliveryRouteConflictError, DeliveryRouteValidationError } from '../../../domain/errors/DeliveryRouteError.js';
import type { PlannedRoute, RoutePlanningStore } from '../../ports/RoutePlanningStore.js';

export const reassignRouteBodySchema = z
  .strictObject({
    driverId: z.uuid().optional(),
    vehicleId: z.uuid().optional(),
  })
  .refine((value) => value.driverId !== undefined || value.vehicleId !== undefined, {
    message: 'At least one resource must be provided',
  });

const commandSchema = z.strictObject({
  organizationId: z.uuid(),
  routeId: z.uuid(),
  ...reassignRouteBodySchema.shape,
});

/**
 * Changes a planned route's driver or vehicle. Stops, links, order statuses and
 * their audit history are untouched: orders are already assigned, so reassigning
 * resources must not invent a status transition or a history row.
 */
export class ReassignRouteUseCase {
  constructor(
    private readonly store: RoutePlanningStore,
    private readonly getDriver: GetDriverUseCase,
    private readonly getVehicle: GetVehicleUseCase,
  ) {}

  async execute(input: unknown): Promise<{ route: PlannedRoute }> {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) {
      throw new DeliveryRouteValidationError('Reassign route command is invalid', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'), message: issue.message,
        })),
      });
    }
    const { organizationId, routeId, driverId, vehicleId } = parsed.data;
    if (driverId !== undefined) {
      const driver = await this.getDriver.execute({ organizationId, driverId });
      if (driver.driver.status !== 'active') {
        throw new DeliveryRouteConflictError('Driver must be active');
      }
    }
    if (vehicleId !== undefined) {
      const vehicle = await this.getVehicle.execute({ organizationId, vehicleId });
      if (vehicle.vehicle.status !== 'active') {
        throw new DeliveryRouteConflictError('Vehicle must be active');
      }
    }
    const changes: { driverId?: string; vehicleId?: string } = {};
    if (driverId !== undefined) changes.driverId = driverId;
    if (vehicleId !== undefined) changes.vehicleId = vehicleId;
    return { route: await this.store.reassign(organizationId, routeId, changes) };
  }
}
