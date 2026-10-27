import { DomainError, type ErrorDetails } from '../../../../shared/errors/DomainError.js';

/**
 * Invalid customer input: malformed identifiers, codes or contact data.
 *
 * Zod failures at the application boundary become this error so callers see one
 * typed family regardless of where validation failed. Details carry field paths
 * and messages only, never rejected contact data.
 */
export class CustomerValidationError extends DomainError {
  readonly code = 'CUSTOMER_INVALID_INPUT';

  constructor(message: string, details?: ErrorDetails) {
    super(message, details);
  }
}

/**
 * The customer does not exist inside the caller organization.
 *
 * Reads are tenant-scoped at the repository, so an id owned by another
 * organization produces this same error; the HTTP layer maps it to 404 for
 * enumeration safety.
 */
export class CustomerNotFoundError extends DomainError {
  readonly code = 'CUSTOMER_NOT_FOUND';
  readonly customerId: string;

  constructor(customerId: string) {
    super(`Customer ${customerId} was not found`);
    this.customerId = customerId;
  }
}

/** A customer business invariant was violated, such as a repeated public code. */
export class CustomerInvariantError extends DomainError {
  readonly code = 'CUSTOMER_INVARIANT_VIOLATION';

  constructor(message: string, details?: ErrorDetails) {
    super(message, details);
  }
}

/**
 * Single definition of the per-organization unique-code invariant.
 *
 * The use-case pre-check and the PostgreSQL unique-constraint translation both
 * raise this value, so a concurrent create cannot produce a different error than
 * a sequential one.
 */
export function customerCodeAlreadyInUse(
  publicCode: string,
  organizationId: string,
): CustomerInvariantError {
  return new CustomerInvariantError(
    `Customer code ${publicCode} is already used in organization ${organizationId}`,
    {
      field: 'publicCode',
      publicCode,
      organizationId,
    },
  );
}
