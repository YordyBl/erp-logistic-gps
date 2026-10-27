import { isUuid } from '../../../../shared/ids.js';
import { CustomerValidationError } from '../errors/CustomerError.js';

export const CUSTOMER_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export const CUSTOMER_STATUSES = ['active', 'inactive'] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const CONTACT_NAME_MAX_LENGTH = 120;

export const CONTACT_EMAIL_MAX_LENGTH = 254;

export const CONTACT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface CustomerCreateProps {
  readonly id: string;
  readonly organizationId: string;
  readonly publicCode: string;
  readonly name: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly status?: CustomerStatus;
  readonly createdAt: string;
}

/**
 * Customer account that contracts delivery services.
 *
 * The customer is catalog data, not an authenticated principal: corporate
 * clients are out of the MVP and use public tracking only (plan §11.2). Identity
 * and tenant are fixed at creation and there is no update use case in this
 * milestone, so the entity exposes no mutator.
 */
export class Customer {
  readonly id: string;
  readonly organizationId: string;
  readonly publicCode: string;
  readonly name: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly status: CustomerStatus;
  readonly createdAt: string;

  private constructor(
    id: string,
    organizationId: string,
    publicCode: string,
    name: string,
    contactName: string,
    contactEmail: string,
    contactPhone: string,
    status: CustomerStatus,
    createdAt: string,
  ) {
    this.id = id;
    this.organizationId = organizationId;
    this.publicCode = publicCode;
    this.name = name;
    this.contactName = contactName;
    this.contactEmail = contactEmail;
    this.contactPhone = contactPhone;
    this.status = status;
    this.createdAt = createdAt;
  }

  static create(props: CustomerCreateProps): Customer {
    if (!isUuid(props.id)) {
      throw new CustomerValidationError('id must be a UUID', { field: 'id' });
    }

    if (!isUuid(props.organizationId)) {
      throw new CustomerValidationError('organizationId must be a UUID', {
        field: 'organizationId',
      });
    }

    const status = props.status ?? 'active';

    if (!isCustomerStatus(status)) {
      throw new CustomerValidationError(
        `status must be one of ${CUSTOMER_STATUSES.join(', ')}`,
        { field: 'status' },
      );
    }

    return new Customer(
      props.id,
      props.organizationId,
      normalizeCustomerCode(props.publicCode),
      requireTrimmedText(props.name, 'name', 2, 120),
      requireTrimmedText(props.contactName, 'contactName', 2, CONTACT_NAME_MAX_LENGTH),
      normalizeContactEmail(props.contactEmail),
      requirePhone(props.contactPhone, 'contactPhone'),
      status,
      requireIsoTimestamp(props.createdAt, 'createdAt'),
    );
  }
}

export function isCustomerStatus(value: unknown): value is CustomerStatus {
  return (CUSTOMER_STATUSES as readonly unknown[]).includes(value);
}

/** Trims and uppercases the readable code so per-organization uniqueness is stable. */
export function normalizeCustomerCode(value: unknown): string {
  if (typeof value !== 'string') {
    throw new CustomerValidationError('publicCode must be a string', {
      field: 'publicCode',
    });
  }

  const normalized = value.trim().toUpperCase();

  if (
    normalized.length < 3 ||
    normalized.length > 32 ||
    !CUSTOMER_CODE_PATTERN.test(normalized)
  ) {
    throw new CustomerValidationError(
      'publicCode must be 3-32 characters of letters, digits and separating hyphens',
      { field: 'publicCode' },
    );
  }

  return normalized;
}

/** Trims and lowercases the contact email, mirroring the users table rule. */
export function normalizeContactEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new CustomerValidationError('contactEmail must be a string', {
      field: 'contactEmail',
    });
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized.length === 0 ||
    normalized.length > CONTACT_EMAIL_MAX_LENGTH ||
    !CONTACT_EMAIL_PATTERN.test(normalized)
  ) {
    throw new CustomerValidationError('contactEmail must be a valid address', {
      field: 'contactEmail',
    });
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
    throw new CustomerValidationError(`${field} must be a string`, { field });
  }

  const normalized = value.trim();

  if (
    normalized.length < minLength ||
    normalized.length > maxLength ||
    (pattern !== undefined && !pattern.test(normalized))
  ) {
    throw new CustomerValidationError(
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
    throw new CustomerValidationError(`${field} must be an ISO-8601 timestamp`, {
      field,
    });
  }

  return value;
}
