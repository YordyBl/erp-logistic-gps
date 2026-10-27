import { isUuid } from '../../../../shared/ids.js';
import { DriverValidationError } from '../errors/DriverError.js';

export const DRIVER_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export const DRIVER_STATUSES = ['active', 'inactive'] as const;

export type DriverStatus = (typeof DRIVER_STATUSES)[number];

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface DriverCreateProps {
  readonly id: string;
  readonly organizationId: string;
  readonly fullName: string;
  readonly documentNumber: string;
  readonly phone: string;
  readonly licenseNumber: string;
  readonly status?: DriverStatus;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

/**
 * Mutable driver attributes.
 *
 * `documentNumber` is deliberately absent: the identity document is fixed at
 * creation and a change would require a different workflow (identity
 * verification) than a catalog edit.
 */
export interface DriverChanges {
  readonly fullName?: string | undefined;
  readonly phone?: string | undefined;
  readonly licenseNumber?: string | undefined;
  readonly status?: DriverStatus | undefined;
}

/**
 * Person who executes delivery routes.
 *
 * The driver is catalog data; the link to a platform user and the route
 * assignment belong to later modules. Tenant and identity are fixed at
 * creation, and every mutation re-runs the same validation as creation.
 */
export class Driver {
  readonly id: string;
  readonly organizationId: string;
  readonly fullName: string;
  readonly documentNumber: string;
  readonly phone: string;
  readonly licenseNumber: string;
  readonly status: DriverStatus;
  readonly createdAt: string;
  readonly updatedAt: string;

  private constructor(
    id: string,
    organizationId: string,
    fullName: string,
    documentNumber: string,
    phone: string,
    licenseNumber: string,
    status: DriverStatus,
    createdAt: string,
    updatedAt: string,
  ) {
    this.id = id;
    this.organizationId = organizationId;
    this.fullName = fullName;
    this.documentNumber = documentNumber;
    this.phone = phone;
    this.licenseNumber = licenseNumber;
    this.status = status;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static create(props: DriverCreateProps): Driver {
    if (!isUuid(props.id)) {
      throw new DriverValidationError('id must be a UUID', { field: 'id' });
    }

    if (!isUuid(props.organizationId)) {
      throw new DriverValidationError('organizationId must be a UUID', {
        field: 'organizationId',
      });
    }

    const status = props.status ?? 'active';

    if (!isDriverStatus(status)) {
      throw new DriverValidationError(
        `status must be one of ${DRIVER_STATUSES.join(', ')}`,
        { field: 'status' },
      );
    }

    const createdAt = requireIsoTimestamp(props.createdAt, 'createdAt');
    const updatedAt =
      props.updatedAt === undefined
        ? createdAt
        : requireIsoTimestamp(props.updatedAt, 'updatedAt');

    return new Driver(
      props.id,
      props.organizationId,
      requireTrimmedText(props.fullName, 'fullName', 2, 120),
      normalizeDriverCode(props.documentNumber, 'documentNumber', 6, 20),
      requirePhone(props.phone, 'phone'),
      normalizeDriverCode(props.licenseNumber, 'licenseNumber', 4, 40),
      status,
      createdAt,
      updatedAt,
    );
  }

  /**
   * Returns a new driver with the supplied attributes replaced.
   *
   * `createdAt` and `documentNumber` are preserved; `updatedAt` is supplied by
   * the use case clock so the aggregate never reads time itself.
   */
  withChanges(changes: DriverChanges, updatedAt: string): Driver {
    const changedFields = [
      changes.fullName,
      changes.phone,
      changes.licenseNumber,
      changes.status,
    ].filter((value) => value !== undefined);

    if (changedFields.length === 0) {
      throw new DriverValidationError('At least one driver field must be provided', {
        field: 'body',
      });
    }

    return Driver.create({
      id: this.id,
      organizationId: this.organizationId,
      fullName: changes.fullName ?? this.fullName,
      documentNumber: this.documentNumber,
      phone: changes.phone ?? this.phone,
      licenseNumber: changes.licenseNumber ?? this.licenseNumber,
      status: changes.status ?? this.status,
      createdAt: this.createdAt,
      updatedAt,
    });
  }
}

export function isDriverStatus(value: unknown): value is DriverStatus {
  return (DRIVER_STATUSES as readonly unknown[]).includes(value);
}

/** Trims and uppercases a document or license so uniqueness and display are stable. */
export function normalizeDriverCode(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    throw new DriverValidationError(`${field} must be a string`, { field });
  }

  const normalized = value.trim().toUpperCase();

  if (
    normalized.length < minLength ||
    normalized.length > maxLength ||
    !DRIVER_CODE_PATTERN.test(normalized)
  ) {
    throw new DriverValidationError(
      `${field} must be ${minLength}-${maxLength} characters of letters, digits and separating hyphens`,
      { field },
    );
  }

  return normalized;
}

export function requirePhone(value: unknown, field: string): string {
  return requireTrimmedText(value, field, 6, 32, /^\+?[0-9][0-9 ()-]*$/);
}

export function requireTrimmedText(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number,
  pattern?: RegExp,
): string {
  if (typeof value !== 'string') {
    throw new DriverValidationError(`${field} must be a string`, { field });
  }

  const normalized = value.trim();

  if (
    normalized.length < minLength ||
    normalized.length > maxLength ||
    (pattern !== undefined && !pattern.test(normalized))
  ) {
    throw new DriverValidationError(
      `${field} must contain between ${minLength} and ${maxLength} characters`,
      { field },
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
    throw new DriverValidationError(`${field} must be an ISO-8601 timestamp`, {
      field,
    });
  }

  return value;
}
