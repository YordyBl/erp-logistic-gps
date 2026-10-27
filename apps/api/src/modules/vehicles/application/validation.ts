import { z, type ZodError } from 'zod';

import {
  MAX_CAPACITY_KG,
  VEHICLE_PLATE_PATTERN,
  VEHICLE_STATUSES,
} from '../domain/entities/Vehicle.js';
import { VehicleValidationError } from '../domain/errors/VehicleError.js';

/**
 * Shared command fragments for the vehicle catalog.
 *
 * Normalization and validation live here as well as in the domain entity: this
 * is the application boundary (ADR-001 rule 8), and the entity re-checks so a
 * row written by an adapter cannot bypass the invariant.
 */
export const vehiclePlateSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(
    z
      .string()
      .min(3)
      .max(16)
      .regex(
        VEHICLE_PLATE_PATTERN,
        'plate must contain letters, digits and separating hyphens',
      ),
  );

export const vehicleTypeSchema = z.string().trim().min(2).max(40);

export const vehicleCapacitySchema = z
  .number()
  .finite()
  .positive()
  .max(MAX_CAPACITY_KG)
  .nullable();

export const vehicleStatusSchema = z.enum(VEHICLE_STATUSES);

/** Converts a Zod failure into the module's typed boundary error. */
export function toVehicleValidationError(
  error: ZodError,
  message: string,
): VehicleValidationError {
  return new VehicleValidationError(message, {
    issues: error.issues.map((issue) => ({
      path: issue.path.map((segment) => String(segment)).join('.'),
      message: issue.message,
    })),
  });
}
