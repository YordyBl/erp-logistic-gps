import type { DeliveryOrderStatus } from '../../domain/policies/DeliveryOrderStatusPolicy.js';

/** PII-free, durable audit record for a status transition. */
export interface DeliveryOrderStatusHistory {
  readonly fromStatus: DeliveryOrderStatus;
  readonly toStatus: DeliveryOrderStatus;
  readonly actorUserId: string;
  readonly occurredAt: string;
}
