import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { GetDriverUseCase } from '../../../../drivers/application/use-cases/get-driver/GetDriverUseCase.js';
import type { GetVehicleUseCase } from '../../../../vehicles/application/use-cases/get-vehicle/GetVehicleUseCase.js';
import { DeliveryRouteConflictError, DeliveryRouteValidationError } from '../../../domain/errors/DeliveryRouteError.js';
import type { PlannedRoute, RoutePlanDraft, RoutePlanningStore } from '../../ports/RoutePlanningStore.js';
import type { Clock } from '../../../../delivery-orders/application/ports/Clock.js';
import type { MapLinkResolver } from '../../ports/MapLinkResolver.js';

/**
 * One stop per order. A stop has no location of its own: the store copies the
 * order's delivery address and coordinates when the route is planned.
 */
const stopSchema = z.strictObject({
  sequence: z.number().int().positive(),
  orderId: z.uuid(),
});

const originSchema = z.strictObject({
  addressLine: z.string().trim().min(5).max(200),
  googleMapsUrl: z.string().trim().url().max(2_048).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
}).refine((origin) => (origin.latitude === undefined) === (origin.longitude === undefined), {
  path: ['latitude'], message: 'latitude and longitude must be provided together',
}).refine((origin) => origin.googleMapsUrl === undefined || origin.latitude === undefined, {
  path: ['googleMapsUrl'], message: 'googleMapsUrl cannot be combined with explicit coordinates',
}).refine((origin) => origin.googleMapsUrl !== undefined || origin.latitude !== undefined, {
  path: ['latitude'], message: 'origin coordinates or googleMapsUrl are required',
});

export const planRouteBodySchema = z.strictObject({
  publicCode: z.string().trim().toUpperCase().min(3).max(32).regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/),
  plannedDate: z.iso.date(),
  driverId: z.uuid(),
  vehicleId: z.uuid(),
  origin: originSchema.optional(),
  simulatedCompletionEnabled: z.boolean().default(false),
  stops: z.array(stopSchema).min(1),
});

const commandSchema = z.strictObject({
  organizationId: z.uuid(), actorUserId: z.uuid(), ...planRouteBodySchema.shape,
});

export interface RouteSimulationOptions {
  /** True only in an explicit development environment with routing geometry available. */
  readonly simulationEnabled: boolean;
}

export class PlanRouteUseCase {
  constructor(private readonly store: RoutePlanningStore,
    private readonly getDriver: GetDriverUseCase,
    private readonly getVehicle: GetVehicleUseCase,
    private readonly clock: Clock,
    private readonly mapLinkResolver: MapLinkResolver,
    private readonly simulation: RouteSimulationOptions = { simulationEnabled: false }) {}

  async execute(input: unknown): Promise<{ route: PlannedRoute }> {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) {
      throw new DeliveryRouteValidationError('Plan route command is invalid', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'), message: issue.message,
        })),
      });
    }
    const { organizationId, actorUserId, driverId, vehicleId, stops, origin,
      simulatedCompletionEnabled } = parsed.data;
    const sequences = stops.map((stop) => stop.sequence);
    const orderIds = stops.map((stop) => stop.orderId);
    if (new Set(sequences).size !== sequences.length ||
        new Set(orderIds).size !== orderIds.length) {
      throw new DeliveryRouteValidationError('Stop sequences and order ids must be unique');
    }
    if (simulatedCompletionEnabled && !this.simulation.simulationEnabled) {
      throw new DeliveryRouteValidationError('Route simulation is only available in development');
    }
    if (simulatedCompletionEnabled && origin === undefined) {
      throw new DeliveryRouteValidationError('Simulated routes require an origin');
    }
    const [driver, vehicle] = await Promise.all([
      this.getDriver.execute({ organizationId, driverId }),
      this.getVehicle.execute({ organizationId, vehicleId }),
    ]);
    if (driver.driver.status !== 'active' || vehicle.vehicle.status !== 'active') {
      throw new DeliveryRouteConflictError('Driver and vehicle must be active');
    }
    const originWithCoordinates = origin === undefined
      ? undefined : await this.resolveLocation(origin, 'origin');
    const route: RoutePlanDraft = {
      id: randomUUID(), organizationId, publicCode: parsed.data.publicCode,
      plannedDate: parsed.data.plannedDate, driverId, vehicleId, status: 'planned',
      ...(originWithCoordinates === undefined ? {} : { origin: originWithCoordinates }),
      simulatedCompletionEnabled,
      createdAt: this.clock.now(),
      stops: stops.map((stop) => ({ id: randomUUID(), sequence: stop.sequence, orderId: stop.orderId }))
        .sort((left, right) => left.sequence - right.sequence),
    };
    return { route: await this.store.plan(route, actorUserId) };
  }

  private async resolveLocation<T extends { readonly addressLine: string;
    readonly googleMapsUrl?: string | undefined; readonly latitude?: number | undefined;
    readonly longitude?: number | undefined }>(
    location: T, path: string,
  ) {
    if (location.googleMapsUrl === undefined) {
      return { addressLine: location.addressLine, latitude: location.latitude!, longitude: location.longitude! };
    }
    try {
      const coordinates = await this.mapLinkResolver.resolve(location.googleMapsUrl);
      return { addressLine: location.addressLine, latitude: coordinates.latitude, longitude: coordinates.longitude };
    } catch {
      throw new DeliveryRouteValidationError('Google Maps link could not be resolved', {
        issues: [{ path: `${path}.googleMapsUrl`, message: 'Use a Google Maps link to a specific location' }],
      });
    }
  }
}
