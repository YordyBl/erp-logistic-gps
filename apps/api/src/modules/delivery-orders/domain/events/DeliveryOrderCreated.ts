import type { DomainEvent } from './DomainEvent.js';

export interface DeliveryOrderCreatedPayload {
  readonly orderId: string;
  readonly organizationId: string;
  readonly publicCode: string;
  readonly occurredAt: string;
}

/**
 * Raised after a delivery order has been accepted and stored.
 *
 * The event intentionally carries identifiers and the readable code only; the
 * recipient's personal data is not copied into event payloads.
 */
export class DeliveryOrderCreated implements DomainEvent {
  readonly name = 'delivery-order.created';
  readonly aggregateId: string;
  readonly orderId: string;
  readonly organizationId: string;
  readonly publicCode: string;
  readonly occurredAt: string;

  constructor(payload: DeliveryOrderCreatedPayload) {
    this.aggregateId = payload.orderId;
    this.orderId = payload.orderId;
    this.organizationId = payload.organizationId;
    this.publicCode = payload.publicCode;
    this.occurredAt = payload.occurredAt;
    Object.freeze(this);
  }
}
