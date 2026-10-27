import { DomainError, type ErrorDetails } from '../../../../shared/errors/DomainError.js';

/** Invalid driver input: malformed identifiers, document, license or status. */
export class DriverValidationError extends DomainError {
  readonly code = 'DRIVER_INVALID_INPUT';

  constructor(message: string, details?: ErrorDetails) {
    super(message, details);
  }
}

/**
 * The driver does not exist inside the caller organization.
 *
 * Reads and writes are tenant-scoped at the repository, so another tenant's id
 * produces the same error as an unknown one.
 */
export class DriverNotFoundError extends DomainError {
  readonly code = 'DRIVER_NOT_FOUND';
  readonly driverId: string;

  constructor(driverId: string) {
    super(`Driver ${driverId} was not found`);
    this.driverId = driverId;
  }
}

/** A driver business invariant was violated, such as a repeated document number. */
export class DriverInvariantError extends DomainError {
  readonly code = 'DRIVER_INVARIANT_VIOLATION';

  constructor(message: string, details?: ErrorDetails) {
    super(message, details);
  }
}

/**
 * Single definition of the per-organization document invariant.
 *
 * The use-case pre-check and the PostgreSQL unique-constraint translation both
 * raise this value.
 */
export function driverDocumentAlreadyInUse(
  documentNumber: string,
  organizationId: string,
): DriverInvariantError {
  return new DriverInvariantError(
    `Driver document ${documentNumber} is already used in organization ${organizationId}`,
    {
      field: 'documentNumber',
      documentNumber,
      organizationId,
    },
  );
}
