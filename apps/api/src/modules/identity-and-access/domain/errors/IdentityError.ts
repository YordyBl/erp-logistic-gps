import { DomainError, type ErrorDetails } from '../../../../shared/errors/DomainError.js';
import type { UserRole } from '../entities/User.js';

/**
 * Invalid command input: malformed identifiers, emails or roles.
 *
 * Zod failures at the application boundary are converted into this error, so
 * callers see one typed family regardless of where validation failed. Details
 * carry field paths and messages only, never rejected personal data.
 */
export class IdentityValidationError extends DomainError {
  readonly code = 'IDENTITY_INVALID_INPUT';

  constructor(message: string, details?: ErrorDetails) {
    super(message, details);
  }
}

/**
 * Generic authentication failure.
 *
 * The message is identical for an unknown email, a wrong password and a
 * disabled account so the response cannot be used to enumerate users
 * (ADR-003 §5).
 */
export class InvalidCredentialsError extends DomainError {
  readonly code = 'IDENTITY_INVALID_CREDENTIALS';

  constructor() {
    super('Invalid email or password');
  }
}

export class EmailAlreadyInUseError extends DomainError {
  readonly code = 'IDENTITY_EMAIL_ALREADY_IN_USE';
  readonly organizationId: string;

  constructor(organizationId: string) {
    super('Email is already in use in this organization', { organizationId });
    this.organizationId = organizationId;
  }
}

export class UserNotFoundError extends DomainError {
  readonly code = 'IDENTITY_USER_NOT_FOUND';
  readonly userId: string;

  constructor(userId: string) {
    super(`User ${userId} was not found`);
    this.userId = userId;
  }
}

export class OrganizationNotFoundError extends DomainError {
  readonly code = 'IDENTITY_ORGANIZATION_NOT_FOUND';
  readonly organizationId: string;

  constructor(organizationId: string) {
    super(`Organization ${organizationId} was not found`);
    this.organizationId = organizationId;
  }
}

/**
 * The authenticated user lacks the role required by the use case.
 *
 * `actualRole` is the role loaded from storage, never a token claim
 * (ADR-003 §2).
 */
export class ForbiddenRoleError extends DomainError {
  readonly code = 'IDENTITY_FORBIDDEN_ROLE';
  readonly requiredRole: UserRole;
  readonly actualRole: UserRole;

  constructor(requiredRole: UserRole, actualRole: UserRole) {
    super(`Role ${actualRole} is not allowed; required role is ${requiredRole}`, {
      requiredRole,
      actualRole,
    });
    this.requiredRole = requiredRole;
    this.actualRole = actualRole;
  }
}

/**
 * A revoked or already-rotated refresh token was presented.
 *
 * Reuse is treated as theft: the whole token family is revoked before the error
 * is raised (ADR-003 §3). The family id is internal and safe to log.
 */
export class RefreshReuseDetectedError extends DomainError {
  readonly code = 'IDENTITY_REFRESH_REUSE_DETECTED';
  readonly familyId: string;

  constructor(familyId: string) {
    super('Refresh token reuse detected; the session family was revoked', {
      familyId,
    });
    this.familyId = familyId;
  }
}

export class RefreshNotFoundError extends DomainError {
  readonly code = 'IDENTITY_REFRESH_NOT_FOUND';

  constructor() {
    super('Refresh token was not found');
  }
}

/**
 * A token cannot be trusted: malformed, wrong signature/algorithm/issuer/
 * audience, expired or missing required claims.
 *
 * Details expose a stable reason, never the token itself.
 */
export class InvalidTokenError extends DomainError {
  readonly code = 'IDENTITY_INVALID_TOKEN';

  constructor(message = 'The token is invalid', details?: ErrorDetails) {
    super(message, details);
  }
}

/**
 * A password violates the ratified policy.
 *
 * Reasons are stable codes; the rejected password never enters the message or
 * the details.
 */
export class WeakPasswordError extends DomainError {
  readonly code = 'IDENTITY_WEAK_PASSWORD';
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super('Password does not meet the security policy', { reasons });
    this.reasons = reasons;
  }
}
