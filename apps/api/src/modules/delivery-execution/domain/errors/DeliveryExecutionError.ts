import { DomainError } from '../../../../shared/errors/DomainError.js';

export class DeliveryEvidenceValidationError extends DomainError {
  readonly code = 'DELIVERY_EVIDENCE_INVALID_INPUT';

  constructor(message: string) { super(message); }
}

export class DeliveryEvidenceNotFoundError extends DomainError {
  readonly code = 'DELIVERY_EVIDENCE_NOT_FOUND';

  constructor() {
    super('Delivery evidence was not found');
  }
}

export class DeliveryEvidenceConflictError extends DomainError {
  readonly code = 'DELIVERY_EVIDENCE_CONFLICT';

  constructor(message: string) { super(message); }
}

export class DeliveryEvidenceUnavailableError extends DomainError {
  readonly code = 'DELIVERY_EVIDENCE_UNAVAILABLE';

  constructor() {
    super('Delivery evidence storage is temporarily unavailable');
  }
}
