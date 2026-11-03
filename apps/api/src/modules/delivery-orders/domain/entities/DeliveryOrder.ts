import { isUuid } from '../../../../shared/ids.js';
import {
  DeliveryOrderInvariantError,
  DeliveryOrderValidationError,
} from '../errors/DeliveryOrderError.js';
import {
  INITIAL_DELIVERY_ORDER_STATUS,
  canTransitionDeliveryOrderStatus,
  isDeliveryOrderStatus,
  type DeliveryOrderStatus,
} from '../policies/DeliveryOrderStatusPolicy.js';
import type { DeliveryAddress } from '../value-objects/DeliveryAddress.js';
import type { Package } from '../value-objects/Package.js';
import type { Recipient } from '../value-objects/Recipient.js';

export const PUBLIC_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface DeliveryOrderCreateProps {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId: string;
  readonly publicCode: string;
  readonly timeWindow: DeliveryTimeWindow;
  readonly recipient: Recipient;
  readonly deliveryAddress: DeliveryAddress;
  readonly packages: readonly Package[];
  readonly createdAt: string;
  readonly activeRouteId?: string | null;
}

export const DELIVERY_TIME_WINDOWS = ['AM', 'PM'] as const;
export type DeliveryTimeWindow = (typeof DELIVERY_TIME_WINDOWS)[number];

/**
 * Aggregate root for a customer order to be transported.
 *
 * The aggregate fixes its identity (`id` internal UUID, `publicCode` readable
 * and separate), tenant (`organizationId`), recipient, address, packages,
 * lifecycle status and timestamps.
 *
 * Status changes use the canonical transition policy; persistence records the
 * transition and its audit row atomically. Delivery execution remains separate.
 */
export class DeliveryOrder {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId: string;
  readonly timeWindow: DeliveryTimeWindow;
  readonly publicCode: string;
  readonly recipient: Recipient;
  readonly deliveryAddress: DeliveryAddress;
  readonly status: DeliveryOrderStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly activeRouteId: string | null;

  private readonly packageItems: readonly Package[];

  private constructor(
    id: string,
    organizationId: string,
    customerId: string,
    timeWindow: DeliveryTimeWindow,
    publicCode: string,
    recipient: Recipient,
    deliveryAddress: DeliveryAddress,
    packages: readonly Package[],
    createdAt: string,
    status: DeliveryOrderStatus = INITIAL_DELIVERY_ORDER_STATUS,
    updatedAt: string = createdAt,
    activeRouteId: string | null = null,
  ) {
    this.id = id;
    this.organizationId = organizationId;
    this.customerId = customerId;
    this.timeWindow = timeWindow;
    this.publicCode = publicCode;
    this.recipient = recipient;
    this.deliveryAddress = deliveryAddress;
    this.packageItems = packages;
    this.status = status;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.activeRouteId = activeRouteId;
  }

  static create(props: DeliveryOrderCreateProps): DeliveryOrder {
    if (!isUuid(props.id)) {
      throw new DeliveryOrderValidationError('id must be a UUID', { field: 'id' });
    }

    if (!isUuid(props.organizationId)) {
      throw new DeliveryOrderValidationError('organizationId must be a UUID', {
        field: 'organizationId',
      });
    }
    if (!isUuid(props.customerId)) {
      throw new DeliveryOrderValidationError('customerId must be a UUID', { field: 'customerId' });
    }
    if (!(DELIVERY_TIME_WINDOWS as readonly unknown[]).includes(props.timeWindow)) {
      throw new DeliveryOrderValidationError('timeWindow must be AM or PM', { field: 'timeWindow' });
    }

    const publicCode = normalizePublicCode(props.publicCode);
    const createdAt = requireIsoTimestamp(props.createdAt, 'createdAt');

    if (props.packages.length === 0) {
      throw new DeliveryOrderInvariantError(
        'A delivery order requires at least one package',
        { field: 'packages' },
      );
    }

    const codes = props.packages.map((item) => item.code);
    if (new Set(codes).size !== codes.length) {
      throw new DeliveryOrderInvariantError(
        'Package codes must be unique within a delivery order',
        { field: 'packages', codes },
      );
    }

    return new DeliveryOrder(
      props.id,
      props.organizationId,
      props.customerId,
      props.timeWindow,
      publicCode,
      props.recipient,
      props.deliveryAddress,
      Object.freeze([...props.packages]),
      createdAt,
      INITIAL_DELIVERY_ORDER_STATUS,
      createdAt,
      props.activeRouteId ?? null,
    );
  }

  get packages(): readonly Package[] {
    return this.packageItems;
  }

  /** Rebuild a persisted order without resetting its status or update instant. */
  static restore(props: DeliveryOrderCreateProps & {
    readonly status: string;
    readonly updatedAt: string;
  }): DeliveryOrder {
    const initial = DeliveryOrder.create(props);
    if (!isDeliveryOrderStatus(props.status)) {
      throw new DeliveryOrderInvariantError('Persisted delivery order status is invalid');
    }
    const updatedAt = requireIsoTimestamp(props.updatedAt, 'updatedAt');
    if (Date.parse(updatedAt) < Date.parse(initial.createdAt)) {
      throw new DeliveryOrderInvariantError('updatedAt cannot precede createdAt');
    }
    return new DeliveryOrder(
      initial.id, initial.organizationId, initial.customerId, initial.timeWindow, initial.publicCode,
      initial.recipient, initial.deliveryAddress, initial.packages,
      initial.createdAt, props.status, updatedAt, props.activeRouteId ?? null,
    );
  }

  cancel(occurredAt: string): DeliveryOrder {
    if (!canTransitionDeliveryOrderStatus(this.status, 'cancelled')) {
      throw new DeliveryOrderInvariantError(
        `Delivery order cannot be cancelled from status ${this.status}`,
        { status: this.status },
      );
    }
    return DeliveryOrder.restore({
      id: this.id, organizationId: this.organizationId, customerId: this.customerId, timeWindow: this.timeWindow, publicCode: this.publicCode,
      recipient: this.recipient, deliveryAddress: this.deliveryAddress,
      packages: this.packages, createdAt: this.createdAt,
      status: 'cancelled', updatedAt: occurredAt,
      activeRouteId: this.activeRouteId,
    });
  }

  /** Details may change only before the order is planned into a route. */
  editDetails(changes: {
    readonly recipient?: Recipient;
    readonly deliveryAddress?: DeliveryAddress;
    readonly packages?: readonly Package[];
  }, occurredAt: string): DeliveryOrder {
    if (this.status !== 'created') {
      throw new DeliveryOrderInvariantError(
        `Delivery order cannot be edited from status ${this.status}`,
        { status: this.status },
      );
    }
    return DeliveryOrder.restore({
      id: this.id, organizationId: this.organizationId, customerId: this.customerId, timeWindow: this.timeWindow, publicCode: this.publicCode,
      recipient: changes.recipient ?? this.recipient,
      deliveryAddress: changes.deliveryAddress ?? this.deliveryAddress,
      packages: changes.packages ?? this.packages,
      createdAt: this.createdAt, updatedAt: occurredAt, status: this.status,
      activeRouteId: this.activeRouteId,
    });
  }

  planAndAssign(routeId: string, plannedAt: string, assignedAt: string): {
    readonly planned: DeliveryOrder; readonly assigned: DeliveryOrder;
  } {
    if (!canTransitionDeliveryOrderStatus(this.status, 'planned') ||
        (this.status === 'created' && this.activeRouteId !== null) ||
        (this.status === 'returned' && this.activeRouteId === null)) {
      throw new DeliveryOrderInvariantError('Only a created order or a returned order with a prior route can be planned');
    }
    if (!isUuid(routeId)) throw new DeliveryOrderValidationError('routeId must be a UUID');
    if (routeId === this.activeRouteId) {
      throw new DeliveryOrderInvariantError('A retry requires a new route');
    }
    // A returned order can be replanned even when a test clock is behind its
    // previous attempt; audit transitions must remain strictly chronological.
    const effectivePlannedAt = this.status === 'returned' &&
      Date.parse(plannedAt) <= Date.parse(this.updatedAt)
      ? new Date(Date.parse(this.updatedAt) + 1).toISOString() : plannedAt;
    const effectiveAssignedAt = this.status === 'returned'
      ? new Date(Math.max(Date.parse(assignedAt), Date.parse(effectivePlannedAt) + 1)).toISOString()
      : assignedAt;
    const planned = DeliveryOrder.restore({
      id: this.id, organizationId: this.organizationId, customerId: this.customerId, timeWindow: this.timeWindow, publicCode: this.publicCode,
      recipient: this.recipient, deliveryAddress: this.deliveryAddress,
      packages: this.packages, createdAt: this.createdAt,
      status: 'planned', updatedAt: effectivePlannedAt, activeRouteId: routeId,
    });
    if (!canTransitionDeliveryOrderStatus(planned.status, 'assigned')) {
      throw new DeliveryOrderInvariantError('Planned order cannot be assigned');
    }
    const assigned = DeliveryOrder.restore({
      id: planned.id, organizationId: planned.organizationId, customerId: planned.customerId, timeWindow: planned.timeWindow, publicCode: planned.publicCode,
      recipient: planned.recipient, deliveryAddress: planned.deliveryAddress,
      packages: planned.packages, createdAt: planned.createdAt,
      status: 'assigned', updatedAt: effectiveAssignedAt, activeRouteId: routeId,
    });
    return { planned, assigned };
  }

  /** A driver starts the assigned route; every order advances with one audited transition. */
  startTransit(routeId: string, occurredAt: string): DeliveryOrder {
    if (this.activeRouteId !== routeId ||
        !canTransitionDeliveryOrderStatus(this.status, 'in_transit')) {
      throw new DeliveryOrderInvariantError('Only an order assigned to this route can enter transit');
    }
    return DeliveryOrder.restore({
      id: this.id, organizationId: this.organizationId, customerId: this.customerId, timeWindow: this.timeWindow, publicCode: this.publicCode,
      recipient: this.recipient, deliveryAddress: this.deliveryAddress,
      packages: this.packages, createdAt: this.createdAt,
      status: 'in_transit', updatedAt: occurredAt, activeRouteId: routeId,
    });
  }
}

function normalizePublicCode(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DeliveryOrderValidationError('publicCode must be a string', {
      field: 'publicCode',
    });
  }

  const normalized = value.trim().toUpperCase();
  if (
    normalized.length < 3 ||
    normalized.length > 32 ||
    !PUBLIC_CODE_PATTERN.test(normalized)
  ) {
    throw new DeliveryOrderValidationError(
      'publicCode must be 3-32 characters of letters, digits and separating hyphens',
      { field: 'publicCode' },
    );
  }

  return normalized;
}

function requireIsoTimestamp(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !ISO_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new DeliveryOrderValidationError(`${field} must be an ISO-8601 timestamp`, {
      field,
    });
  }

  return value;
}
