import { isUuid } from '../../../../shared/ids.js';
import { VehicleValidationError } from '../errors/VehicleError.js';

export const VEHICLE_PLATE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export const VEHICLE_STATUSES = ['active', 'inactive'] as const;

export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const MAX_CAPACITY_KG = 100_000;

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface VehicleCreateProps {
  readonly id: string;
  readonly organizationId: string;
  readonly plate: string;
  readonly type: string;
  readonly capacityKg?: number | null;
  readonly status?: VehicleStatus;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

/**
 * Mutable vehicle attributes.
 *
 * The plate is deliberately absent: it is the fleet identifier and changing it
 * is a re-registration, not a catalog edit.
 */
export interface VehicleChanges {
  readonly type?: string | undefined;
  readonly capacityKg?: number | null | undefined;
  readonly status?: VehicleStatus | undefined;
}

/**
 * Fleet unit and availability.
 *
 * `capacityKg` is optional: a vehicle type may not declare a payload. An explicit
 * `null` in an update clears a previously known capacity, which is why the field
 * distinguishes `undefined` from `null`.
 */
export class Vehicle {
  readonly id: string;
  readonly organizationId: string;
  readonly plate: string;
  readonly type: string;
  readonly capacityKg: number | null;
  readonly status: VehicleStatus;
  readonly createdAt: string;
  readonly updatedAt: string;

  private constructor(
    id: string,
    organizationId: string,
    plate: string,
    type: string,
    capacityKg: number | null,
    status: VehicleStatus,
    createdAt: string,
    updatedAt: string,
  ) {
    this.id = id;
    this.organizationId = organizationId;
    this.plate = plate;
    this.type = type;
    this.capacityKg = capacityKg;
    this.status = status;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static create(props: VehicleCreateProps): Vehicle {
    if (!isUuid(props.id)) {
      throw new VehicleValidationError('id must be a UUID', { field: 'id' });
    }

    if (!isUuid(props.organizationId)) {
      throw new VehicleValidationError('organizationId must be a UUID', {
        field: 'organizationId',
      });
    }

    const status = props.status ?? 'active';

    if (!isVehicleStatus(status)) {
      throw new VehicleValidationError(
        `status must be one of ${VEHICLE_STATUSES.join(', ')}`,
        { field: 'status' },
      );
    }

    const createdAt = requireIsoTimestamp(props.createdAt, 'createdAt');
    const updatedAt =
      props.updatedAt === undefined
        ? createdAt
        : requireIsoTimestamp(props.updatedAt, 'updatedAt');

    return new Vehicle(
      props.id,
      props.organizationId,
      normalizePlate(props.plate),
      requireTrimmedText(props.type, 'type', 2, 40),
      normalizeCapacity(props.capacityKg),
      status,
      createdAt,
      updatedAt,
    );
  }

  /**
   * Returns a new vehicle with the supplied attributes replaced.
   *
   * `plate` and `createdAt` are preserved; `null` clears the capacity and
   * `undefined` leaves it untouched.
   */
  withChanges(changes: VehicleChanges, updatedAt: string): Vehicle {
    const changedFields = [
      changes.type,
      changes.capacityKg === undefined ? undefined : changes.capacityKg,
      changes.status,
    ].filter((value) => value !== undefined);

    if (changedFields.length === 0) {
      throw new VehicleValidationError(
        'At least one vehicle field must be provided',
        { field: 'body' },
      );
    }

    return Vehicle.create({
      id: this.id,
      organizationId: this.organizationId,
      plate: this.plate,
      type: changes.type ?? this.type,
      capacityKg:
        changes.capacityKg === undefined ? this.capacityKg : changes.capacityKg,
      status: changes.status ?? this.status,
      createdAt: this.createdAt,
      updatedAt,
    });
  }
}

export function isVehicleStatus(value: unknown): value is VehicleStatus {
  return (VEHICLE_STATUSES as readonly unknown[]).includes(value);
}

/** Trims and uppercases the plate so per-organization uniqueness is stable. */
export function normalizePlate(value: unknown): string {
  if (typeof value !== 'string') {
    throw new VehicleValidationError('plate must be a string', { field: 'plate' });
  }

  const normalized = value.trim().toUpperCase();

  if (
    normalized.length < 3 ||
    normalized.length > 16 ||
    !VEHICLE_PLATE_PATTERN.test(normalized)
  ) {
    throw new VehicleValidationError(
      'plate must be 3-16 characters of letters, digits and separating hyphens',
      { field: 'plate' },
    );
  }

  return normalized;
}

function normalizeCapacity(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_CAPACITY_KG
  ) {
    throw new VehicleValidationError(
      `capacityKg must be a positive number up to ${MAX_CAPACITY_KG}`,
      { field: 'capacityKg' },
    );
  }

  return value;
}

function requireTrimmedText(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    throw new VehicleValidationError(`${field} must be a string`, { field });
  }

  const normalized = value.trim();

  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new VehicleValidationError(
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
    throw new VehicleValidationError(`${field} must be an ISO-8601 timestamp`, {
      field,
    });
  }

  return value;
}
