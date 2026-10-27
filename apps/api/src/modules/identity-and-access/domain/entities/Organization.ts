import { isUuid } from '../../../../shared/ids.js';
import { IdentityValidationError } from '../errors/IdentityError.js';

export const ORGANIZATION_NAME_MIN_LENGTH = 2;
export const ORGANIZATION_NAME_MAX_LENGTH = 120;

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface OrganizationCreateProps {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

/**
 * Tenant boundary of the platform.
 *
 * Every user, delivery order and future catalog row belongs to exactly one
 * organization (architecture plan §11.1). The name is a display label only: it
 * is trimmed, length-bounded and not unique, because two customers may share a
 * commercial name and authorization never depends on it.
 */
export class Organization {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;

  private constructor(id: string, name: string, createdAt: string) {
    this.id = id;
    this.name = name;
    this.createdAt = createdAt;
  }

  static create(props: OrganizationCreateProps): Organization {
    if (!isUuid(props.id)) {
      throw new IdentityValidationError('id must be a UUID', { field: 'id' });
    }

    const name = normalizeOrganizationName(props.name);

    return new Organization(
      props.id,
      name,
      requireIsoTimestamp(props.createdAt, 'createdAt'),
    );
  }
}

function normalizeOrganizationName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new IdentityValidationError('name must be a string', { field: 'name' });
  }

  const normalized = value.trim();

  if (
    normalized.length < ORGANIZATION_NAME_MIN_LENGTH ||
    normalized.length > ORGANIZATION_NAME_MAX_LENGTH
  ) {
    throw new IdentityValidationError(
      `name must be ${ORGANIZATION_NAME_MIN_LENGTH}-${ORGANIZATION_NAME_MAX_LENGTH} characters`,
      { field: 'name' },
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
    throw new IdentityValidationError(`${field} must be an ISO-8601 timestamp`, {
      field,
    });
  }

  return value;
}
