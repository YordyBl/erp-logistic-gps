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

export const NAME_PART_MAX_LENGTH = 60;

/**
 * Peruvian naming: nombres, apellido paterno and an optional apellido materno
 * (people with a single surname, such as many foreign residents, leave it out).
 */
export interface PersonName {
  readonly firstName: string;
  readonly paternalSurname: string;
  readonly maternalSurname: string | null;
}

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
  /** Null only for accounts created before names were recorded. */
  readonly name?: PersonName | null;
  /** Last successful sign-in; null when the account never signed in. */
  readonly lastLoginAt?: string | null;
}

type UserChanges = Partial<Pick<UserCreateProps, 'passwordHash' | 'role' | 'status' | 'name' | 'lastLoginAt'>>;

/**
 * Platform user inside exactly one organization.
 *
 * Users are created only by an ADMIN of the same organization (architecture
 * plan §11.2): there is no self-registration or public sign-up. The entity
 * fixes identity and tenant; `role` and `status` are assigned by a use case and
 * reloaded from storage on every authentication, so a stale access token cannot
 * keep an old role (ADR-003 §2).
 *
 * `passwordHash` is never serialized to a DTO or logged. Role, status, name and
 * password changes go through {@link User.with}, which re-validates the whole
 * entity; the ADMIN-only `update-user` use case decides which are allowed.
 */
export class User {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly createdAt: string;
  readonly name: PersonName | null;
  readonly lastLoginAt: string | null;

  private constructor(
    id: string,
    organizationId: string,
    email: string,
    passwordHash: string,
    role: UserRole,
    status: UserStatus,
    createdAt: string,
    name: PersonName | null,
    lastLoginAt: string | null,
  ) {
    this.id = id;
    this.organizationId = organizationId;
    this.email = email;
    this.passwordHash = passwordHash;
    this.role = role;
    this.status = status;
    this.createdAt = createdAt;
    this.name = name;
    this.lastLoginAt = lastLoginAt;
  }

  /** A copy with some fields replaced, validated like a new entity. */
  with(changes: UserChanges): User {
    return User.create({
      id: this.id,
      organizationId: this.organizationId,
      email: this.email,
      passwordHash: this.passwordHash,
      role: this.role,
      status: this.status,
      createdAt: this.createdAt,
      name: this.name,
      lastLoginAt: this.lastLoginAt,
      ...changes,
    });
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
      props.name === undefined || props.name === null ? null : normalizePersonName(props.name),
      props.lastLoginAt === undefined || props.lastLoginAt === null
        ? null
        : requireIsoTimestamp(props.lastLoginAt, 'lastLoginAt'),
    );
  }
}

/** Trims each part; nombres and apellido paterno are required, materno is optional. */
export function normalizePersonName(value: PersonName): PersonName {
  return {
    firstName: namePart(value.firstName, 'firstName', true)!,
    paternalSurname: namePart(value.paternalSurname, 'paternalSurname', true)!,
    maternalSurname: namePart(value.maternalSurname, 'maternalSurname', false),
  };
}

/** «Nombres Paterno Materno», or null when the account has no name yet. */
export function displayName(name: PersonName | null): string | null {
  if (name === null) return null;
  return [name.firstName, name.paternalSurname, name.maternalSurname]
    .filter((part): part is string => part !== null)
    .join(' ');
}

function namePart(raw: unknown, field: string, required: boolean): string | null {
  if (raw === null || raw === undefined) {
    if (required) throw new IdentityValidationError(`${field} is required`, { field });
    return null;
  }
  if (typeof raw !== 'string') {
    throw new IdentityValidationError(`${field} must be a string`, { field });
  }
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    if (required) throw new IdentityValidationError(`${field} is required`, { field });
    return null;
  }
  if (trimmed.length > NAME_PART_MAX_LENGTH) {
    throw new IdentityValidationError(
      `${field} must be at most ${NAME_PART_MAX_LENGTH} characters`,
      { field },
    );
  }
  return trimmed;
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
