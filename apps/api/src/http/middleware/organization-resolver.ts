import type { NextFunction, Request, Response } from 'express';

import { isUuid } from '../../shared/ids.js';
import { HttpError } from '../errors.js';
import { getOrganizationId, setOrganizationId } from '../request-context.js';

/**
 * TEMPORARY (Fase 0 only): development tenant context.
 *
 * The API has no authentication yet. This middleware reads the caller's
 * organization from the `x-organization-id` header so the delivery-orders routes
 * exercise real tenant scoping. Fase 1 replaces this adapter with verified JWT
 * claims (ADR-003): the header disappears, the routes keep receiving the
 * organization from the request context, and application use cases do not
 * change.
 *
 * The header is a development convenience, not an authorization mechanism: any
 * caller can claim any organization until authentication lands.
 */
export const ORGANIZATION_HEADER = 'x-organization-id';

export function organizationResolver(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const organizationId = request.header(ORGANIZATION_HEADER)?.trim();

  if (organizationId === undefined || organizationId.length === 0) {
    throw new HttpError(
      401,
      'ORGANIZATION_REQUIRED',
      `The ${ORGANIZATION_HEADER} header is required`,
    );
  }

  if (!isUuid(organizationId)) {
    throw new HttpError(
      401,
      'ORGANIZATION_INVALID',
      `The ${ORGANIZATION_HEADER} header must be a UUID`,
    );
  }

  setOrganizationId(response, organizationId);
  next();
}

/**
 * Reads the organization established by {@link organizationResolver}.
 *
 * Throwing here is defense in depth: a route mounted without the resolver fails
 * closed instead of running without tenant scope.
 */
export function requireOrganizationId(response: Response): string {
  const organizationId = getOrganizationId(response);

  if (organizationId === undefined) {
    throw new HttpError(
      401,
      'ORGANIZATION_REQUIRED',
      `The ${ORGANIZATION_HEADER} header is required`,
    );
  }

  return organizationId;
}
