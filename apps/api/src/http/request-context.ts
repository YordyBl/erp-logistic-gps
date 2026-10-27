import type { Response } from 'express';

import type { UserRole } from '../modules/identity-and-access/domain/entities/User.js';

/**
 * Authenticated caller resolved from a verified access token and reloaded from
 * storage. `role` is the stored role, never a token claim: a demotion must take
 * effect on the next request (ADR-003 §2).
 */
export interface AuthenticatedUser {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: UserRole;
}

/**
 * Request-scoped context shared by middleware, routes and the error handler.
 *
 * `res.locals` is Express's request-scoped store. This module is the single
 * typed accessor, so no handler reads or writes arbitrary locals keys directly.
 */
interface RequestContext {
  correlationId?: string;
  organizationId?: string;
  user?: AuthenticatedUser;
}

function contextOf(response: Response): RequestContext {
  return response.locals as RequestContext;
}

export function setCorrelationId(response: Response, correlationId: string): void {
  contextOf(response).correlationId = correlationId;
}

export function getCorrelationId(response: Response): string | undefined {
  return contextOf(response).correlationId;
}

export function getOrganizationId(response: Response): string | undefined {
  return contextOf(response).organizationId;
}

/**
 * Stores the authenticated caller and derives the tenant from it.
 *
 * The organization is written once here so every downstream route continues to
 * call `getOrganizationId` and cannot disagree with the verified identity.
 */
export function setAuthenticatedUser(
  response: Response,
  user: AuthenticatedUser,
): void {
  const context = contextOf(response);
  context.user = user;
  context.organizationId = user.organizationId;
}

export function getAuthenticatedUser(response: Response): AuthenticatedUser | undefined {
  return contextOf(response).user;
}
