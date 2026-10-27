import { isUuid } from '../../../../shared/ids.js';
import {
  IdentityValidationError,
} from '../errors/IdentityError.js';

export const USER_ROLES = ['ADMIN', 'DISPATCHER', 'DRIVER'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['active', 'disabled'] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export const EMAIL_MAX_LENGTH = 254;

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface UserCreateProps {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  /** Argon2id hash. The plaintext password never reaches the entity. */
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly createdAt: string;
}

/**
 * Platform user inside exactly one organization.
 *
 * Users are created only by an ADMIN of the same organization (architecture
 * plan §11.2): there is no self-registration or public sign-up. The entity
 * fixes identity and tenant; `role` and `status` are assigned by a use case and
 * reloaded from storage on every authentication, so a stale access token cannot
 * keep an old role (ADR-003 §2).
 *
 * `passwordHash` is never serialized to a DTO or logged. Status transitions
 * (disable/enable) belong to a later use case; this milestone only creates
 * `active` users.
 */
export class User {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly createdAt: string;

  private constructor(
    id: string,
    organizationId: string,
    email: string,
    passwordHash: string,
    role: UserRole,
    status: UserStatus,
    createdAt: string,
  ) {
    this.id = id;
    this.organizationId = organizationId;
    this.email = email;
    this.passwordHash = passwordHash;
    this.role = role;
    this.status = status;
    this.createdAt = createdAt;
  }

  static create(props: UserCreateProps): User {
    if (!isUuid(props.id)) {
      throw new IdentityValidationError('id must be a UUID', { field: 'id' });
    }

    if (!isUuid(props.organizationId)) {
      throw new IdentityValidationError('organizationId must be a UUID', {
        field: 'organizationId',
      });
    }

    const email = normalizeEmail(props.email);

    if (!isUserRole(props.role)) {
      throw new IdentityValidationError(
        `role must be one of ${USER_ROLES.join(', ')}`,
        { field: 'role' },
      );
    }

    if (!isUserStatus(props.status)) {
      throw new IdentityValidationError(
        `status must be one of ${USER_STATUSES.join(', ')}`,
        { field: 'status' },
      );
    }

    if (
      typeof props.passwordHash !== 'string' ||
      props.passwordHash.trim().length === 0 ||
      props.passwordHash.length > 255
    ) {
      throw new IdentityValidationError(
        'passwordHash must be a non-empty string of at most 255 characters',
        { field: 'passwordHash' },
      );
    }

    return new User(
      props.id,
      props.organizationId,
      email,
      props.passwordHash,
      props.role,
      props.status,
      requireIsoTimestamp(props.createdAt, 'createdAt'),
    );
  }
}

/** Trims and lowercases an email so per-organization uniqueness is stable. */
export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new IdentityValidationError('email must be a string', { field: 'email' });
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized.length === 0 ||
    normalized.length > EMAIL_MAX_LENGTH ||
    !EMAIL_PATTERN.test(normalized)
  ) {
    throw new IdentityValidationError('email must be a valid address', {
      field: 'email',
    });
  }

  return normalized;
}

export function isUserRole(value: unknown): value is UserRole {
  return (USER_ROLES as readonly unknown[]).includes(value);
}

export function isUserStatus(value: unknown): value is UserStatus {
  return (USER_STATUSES as readonly unknown[]).includes(value);
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
