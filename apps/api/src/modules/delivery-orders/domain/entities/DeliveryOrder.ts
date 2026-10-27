import { isUuid } from '../../../../shared/ids.js';
import {
  DeliveryOrderInvariantError,
  DeliveryOrderValidationError,
} from '../errors/DeliveryOrderError.js';
import {
  INITIAL_DELIVERY_ORDER_STATUS,
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
 * Status can only change through explicit use-case decisions. This pilot has no
 * transition use case yet, so the entity has no mutator and always starts in
 * `created`; `confirm-delivery` and `report-delivery-incident` belong to the
 * future `delivery-execution` module. Keeping the field read-only means no
 * accidental status change can bypass a use case.
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
  ) {
    this.id = id;
    this.organizationId = organizationId;
    this.publicCode = publicCode;
    this.recipient = recipient;
    this.deliveryAddress = deliveryAddress;
    this.packageItems = packages;
    this.status = INITIAL_DELIVERY_ORDER_STATUS;
    this.createdAt = createdAt;
    this.updatedAt = createdAt;
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
