/**
 * Canonical order-side status vocabulary for the pilot.
 *
 * The conceptual data model lists a working set and delegates the canonical
 * vocabulary to this module (`docs/architecture/data-model.md`). The set below
 * is the order's lifecycle only:
 *
 * - `created`   the order exists and has not been planned into a route yet
 * - `planned`   a dispatcher has placed it on a planned route
 * - `assigned`  a route, driver and vehicle are assigned and the order is queued
 * - `in_transit` the driver started the route containing the order
 * - `delivered` a successful delivery attempt confirmed this order
 * - `returned`  a delivery incident failed the attempt and the order came back
 * - `cancelled` the order was cancelled before delivery
 *
 * `failed` is deliberately not an order status. Failure belongs to
 * `DeliveryAttempt.status`; the ratified incident rule records "failed attempt"
 * on the attempt and moves the order straight to `returned` in the same
 * transaction (architecture plan §11.4, invariant 14). This avoids an
 * intermediate order state that would imply a field retry, which the MVP
 * forbids.
 *
 * Scope note: the `confirm-delivery` and `report-delivery-incident` use cases
 * belong to the future `delivery-execution` module. This pilot defines only the
 * order-side statuses and allowed transitions; nothing here executes them yet.
 */

export const DELIVERY_ORDER_STATUSES = [
  'created',
  'planned',
  'assigned',
  'in_transit',
  'delivered',
  'returned',
  'cancelled',
] as const;

export type DeliveryOrderStatus = (typeof DELIVERY_ORDER_STATUSES)[number];

export const INITIAL_DELIVERY_ORDER_STATUS: DeliveryOrderStatus = 'created';

const ALLOWED_TRANSITIONS: Readonly<
  Record<DeliveryOrderStatus, readonly DeliveryOrderStatus[]>
> = {
  created: ['planned', 'cancelled'],
  planned: ['assigned', 'cancelled'],
  assigned: ['in_transit', 'cancelled'],
  in_transit: ['delivered', 'returned'],
  delivered: [],
  returned: [],
  cancelled: [],
};

export function isDeliveryOrderStatus(value: string): value is DeliveryOrderStatus {
  return (DELIVERY_ORDER_STATUSES as readonly string[]).includes(value);
}

export function allowedTransitionsFrom(
  status: DeliveryOrderStatus,
): readonly DeliveryOrderStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

export function canTransitionDeliveryOrderStatus(
  from: DeliveryOrderStatus,
  to: DeliveryOrderStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
