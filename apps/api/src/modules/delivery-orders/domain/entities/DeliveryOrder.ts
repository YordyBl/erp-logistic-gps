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
  readonly publicCode: string;
  readonly recipient: Recipient;
  readonly deliveryAddress: DeliveryAddress;
  readonly packages: readonly Package[];
  readonly createdAt: string;
}

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
  readonly publicCode: string;
  readonly recipient: Recipient;
  readonly deliveryAddress: DeliveryAddress;
  readonly status: DeliveryOrderStatus;
  readonly createdAt: string;
  readonly updatedAt: string;

  private readonly packageItems: readonly Package[];

  private constructor(
    id: string,
    organizationId: string,
    publicCode: string,
    recipient: Recipient,
    deliveryAddress: DeliveryAddress,
    packages: readonly Package[],
    createdAt: string,
    status: DeliveryOrderStatus = INITIAL_DELIVERY_ORDER_STATUS,
    updatedAt: string = createdAt,
  ) {
    this.id = id;
    this.organizationId = organizationId;
    this.publicCode = publicCode;
    this.recipient = recipient;
    this.deliveryAddress = deliveryAddress;
    this.packageItems = packages;
    this.status = status;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
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
      publicCode,
      props.recipient,
      props.deliveryAddress,
      Object.freeze([...props.packages]),
      createdAt,
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
      initial.id, initial.organizationId, initial.publicCode,
      initial.recipient, initial.deliveryAddress, initial.packages,
      initial.createdAt, props.status, updatedAt,
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
      id: this.id, organizationId: this.organizationId, publicCode: this.publicCode,
      recipient: this.recipient, deliveryAddress: this.deliveryAddress,
      packages: this.packages, createdAt: this.createdAt,
      status: 'cancelled', updatedAt: occurredAt,
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
