import type { DeliveryOrder } from '../../domain/entities/DeliveryOrder.js';
import type { DeliveryAddress } from '../../domain/value-objects/DeliveryAddress.js';
import type { Package } from '../../domain/value-objects/Package.js';
import type { Recipient } from '../../domain/value-objects/Recipient.js';
import type { DeliveryOrderStatusHistory } from './DeliveryOrderStatusHistory.js';

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
  /** Reserve globally unique readable codes for a new order and its parcels. */
  nextCodes(packageCount: number): Promise<{
    readonly publicCode: string;
    readonly packageCodes: readonly string[];
  }>;
  save(order: DeliveryOrder): Promise<void>;
  findById(orderId: string): Promise<DeliveryOrder | null>;
  findByPublicCode(
    organizationId: string,
    publicCode: string,
  ): Promise<DeliveryOrder | null>;
  /** Stable order for tenant-scoped listing; never returns another tenant's orders. */
  list(organizationId: string): Promise<readonly DeliveryOrder[]>;
  /** Lock and recheck tenant/status before changing order-owned details. */
  editDetails(organizationId: string, orderId: string, changes: {
    readonly recipient?: Recipient;
    readonly deliveryAddress?: DeliveryAddress;
    readonly packages?: readonly Package[];
  }, occurredAt: string): Promise<DeliveryOrder>;
  /** Atomically change status and append its audit row, or change neither. */
  cancel(
    organizationId: string,
    orderId: string,
    actorUserId: string,
    occurredAt: string,
  ): Promise<DeliveryOrder>;
  findStatusHistory(organizationId: string, orderId: string): Promise<readonly DeliveryOrderStatusHistory[]>;
}
