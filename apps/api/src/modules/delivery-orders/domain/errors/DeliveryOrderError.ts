import { DomainError, type ErrorDetails } from '../../../../shared/errors/DomainError.js';

/**
 * Invalid input values: malformed commands, value objects and identifiers.
 *
 * The application boundary maps Zod failures into this error so callers see one
 * typed error family regardless of where validation failed.
 */
export class DeliveryOrderValidationError extends DomainError {
  readonly code = 'DELIVERY_ORDER_INVALID_INPUT';

  constructor(message: string, details?: ErrorDetails) {
    super(message, details);
  }
}

export class DeliveryOrderNotFoundError extends DomainError {
  readonly code = 'DELIVERY_ORDER_NOT_FOUND';
  readonly orderId: string;

  constructor(orderId: string) {
    super(`Delivery order ${orderId} was not found`);
    this.orderId = orderId;
  }
}

export class DeliveryOrderForbiddenError extends DomainError {
  readonly code = 'DELIVERY_ORDER_FORBIDDEN';
  readonly orderId: string;
  readonly organizationId: string;

  constructor(orderId: string, organizationId: string) {
    super(`Delivery order ${orderId} is not accessible to organization ${organizationId}`);
    this.orderId = orderId;
    this.organizationId = organizationId;
  }
}

/**
 * A business invariant was violated, for example an order without packages or a
 * public code repeated inside one organization.
 */
export class DeliveryOrderInvariantError extends DomainError {
  readonly code = 'DELIVERY_ORDER_INVARIANT_VIOLATION';

  constructor(message: string, details?: ErrorDetails) {
    super(message, details);
  }
}
