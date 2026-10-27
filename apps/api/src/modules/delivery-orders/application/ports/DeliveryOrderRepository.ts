import type { DeliveryOrder } from '../../domain/entities/DeliveryOrder.js';

/**
 * Persistence contract for the {@link DeliveryOrder} aggregate.
 *
 * `findById` intentionally has no tenant filter: the use case must distinguish
 * "order does not exist" from "order exists in another organization" and apply
 * the organization check itself. `findByPublicCode` is tenant-scoped because
 * readable public codes are unique per organization.
 *
 * Repository implementations return domain aggregates, never persistence
 * entities (ADR-002 §2). Cross-module code must not use this port directly
 * (ADR-001 rule 6).
 */
export interface DeliveryOrderRepository {
  save(order: DeliveryOrder): Promise<void>;
  findById(orderId: string): Promise<DeliveryOrder | null>;
  findByPublicCode(
    organizationId: string,
    publicCode: string,
  ): Promise<DeliveryOrder | null>;
}
