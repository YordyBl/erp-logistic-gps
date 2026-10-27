/**
 * Minimal shape every domain event in the module exposes.
 *
 * The pilot publishes events in-process. Delivery guarantees, replay and a
 * transactional outbox are cross-module concerns still pending in the
 * architecture plan (§11.11); this contract keeps that decision replaceable.
 */
export interface DomainEvent {
  /** Stable event name, for example `delivery-order.created`. */
  readonly name: string;
  /** Identifier of the aggregate that produced the event. */
  readonly aggregateId: string;
  /** Tenant that owns the aggregate. */
  readonly organizationId: string;
  /** Instant when the event happened, ISO-8601. */
  readonly occurredAt: string;
}
