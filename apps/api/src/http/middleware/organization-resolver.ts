import type { Response } from 'express';

import { HttpError } from '../errors.js';
import { getOrganizationId } from '../request-context.js';
import { AUTH_TOKEN_MISSING_MESSAGE } from './authenticate.js';

/**
 * Reads the tenant established by the JWT authentication middleware.
 *
 * Fase 0 resolved this value from the spoofable `x-organization-id` header.
 * Since Fase 1 the organization is a verified token claim reloaded from
 * storage, so callers cannot claim another tenant (ADR-003, S9).
 *
 * Throwing here is defense in depth: a route mounted without authentication
 * fails closed instead of running without tenant scope.
 */
export function requireOrganizationId(response: Response): string {
  const organizationId = getOrganizationId(response);

  if (organizationId === undefined) {
    throw new HttpError(401, 'AUTH_TOKEN_MISSING', AUTH_TOKEN_MISSING_MESSAGE);
  }

  return organizationId;
}
