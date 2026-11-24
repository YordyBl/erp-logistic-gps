import type { Organization } from '../../domain/entities/Organization.js';
import type { User, UserRole, UserStatus } from '../../domain/entities/User.js';

/** Safe user projection: never contains `passwordHash`. */
export interface UserDto {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly createdAt: string;
  /** Null together for accounts created before names were recorded. */
  readonly firstName: string | null;
  readonly paternalSurname: string | null;
  readonly maternalSurname: string | null;
  /** Last successful sign-in; null when the account never signed in. */
  readonly lastLoginAt: string | null;
}

/** Minimal identity carried inside an authenticated session. */
export interface AuthenticatedUserDto {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: UserRole;
}

export interface OrganizationDto {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    firstName: user.name?.firstName ?? null,
    paternalSurname: user.name?.paternalSurname ?? null,
    maternalSurname: user.name?.maternalSurname ?? null,
    lastLoginAt: user.lastLoginAt,
  };
}

export function toAuthenticatedUserDto(user: User): AuthenticatedUserDto {
  return {
    id: user.id,
    organizationId: user.organizationId,
    email: user.email,
    role: user.role,
  };
}

export function toOrganizationDto(organization: Organization): OrganizationDto {
  return {
    id: organization.id,
    name: organization.name,
    createdAt: organization.createdAt,
  };
}
