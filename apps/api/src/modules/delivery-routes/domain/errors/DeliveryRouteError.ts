import { DomainError, type ErrorDetails } from '../../../../shared/errors/DomainError.js';

export class DeliveryRouteValidationError extends DomainError {
  readonly code = 'DELIVERY_ROUTE_INVALID_INPUT';
  constructor(message: string, details?: ErrorDetails) { super(message, details); }
}

export class DeliveryRouteNotFoundError extends DomainError {
  readonly code = 'DELIVERY_ROUTE_NOT_FOUND';
  constructor() { super('Delivery route resource was not found'); }
}

export class DeliveryRouteConflictError extends DomainError {
  readonly code = 'DELIVERY_ROUTE_CONFLICT';
  constructor(message: string) { super(message); }
}
