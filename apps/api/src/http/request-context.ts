import type { Response } from 'express';

/**
 * Request-scoped context shared by middleware, routes and the error handler.
 *
 * `res.locals` is Express's request-scoped store. This module is the single
 * typed accessor, so no handler reads or writes arbitrary locals keys directly.
 */
interface RequestContext {
  correlationId?: string;
  organizationId?: string;
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

export function setOrganizationId(response: Response, organizationId: string): void {
  contextOf(response).organizationId = organizationId;
}

export function getOrganizationId(response: Response): string | undefined {
  return contextOf(response).organizationId;
}
