import type { DomainEvent } from '../../domain/events/DomainEvent.js';

/**
 * Publishes domain events produced by use cases.
 *
 * The pilot adapter is in-process and synchronous. Cross-module delivery,
 * retries and a transactional outbox are pending in the architecture plan
 * (§11.11); a future adapter can implement this port without changing use cases.
 */
export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
