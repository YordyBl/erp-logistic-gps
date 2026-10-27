import { DomainError, type ErrorDetails } from '../../../../shared/errors/DomainError.js';

/** Invalid vehicle input: malformed identifiers, plate, type or capacity. */
export class VehicleValidationError extends DomainError {
  readonly code = 'VEHICLE_INVALID_INPUT';

  constructor(message: string, details?: ErrorDetails) {
    super(message, details);
  }
}

/**
 * The vehicle does not exist inside the caller organization.
 *
 * Reads and writes are tenant-scoped at the repository, so another tenant's id
 * produces the same error as an unknown one.
 */
export class VehicleNotFoundError extends DomainError {
  readonly code = 'VEHICLE_NOT_FOUND';
  readonly vehicleId: string;

  constructor(vehicleId: string) {
    super(`Vehicle ${vehicleId} was not found`);
    this.vehicleId = vehicleId;
  }
}

/** A vehicle business invariant was violated, such as a repeated plate. */
export class VehicleInvariantError extends DomainError {
  readonly code = 'VEHICLE_INVARIANT_VIOLATION';

  constructor(message: string, details?: ErrorDetails) {
    super(message, details);
  }
}

/**
 * Single definition of the per-organization plate invariant.
 *
 * The use-case pre-check and the PostgreSQL unique-constraint translation both
 * raise this value.
 */
export function vehiclePlateAlreadyInUse(
  plate: string,
  organizationId: string,
): VehicleInvariantError {
  return new VehicleInvariantError(
    `Vehicle plate ${plate} is already used in organization ${organizationId}`,
    {
      field: 'plate',
      plate,
      organizationId,
    },
  );
}
