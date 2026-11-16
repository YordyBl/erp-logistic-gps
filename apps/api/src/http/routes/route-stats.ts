import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z, type ZodType } from 'zod';

import {
  DEFAULT_ROUTE_STATS_MONTHS, MAX_ROUTE_STATS_MONTHS, type RouteStatsScope,
} from '../../infrastructure/dispatch/RouteStatsTypeOrmQuery.js';
import { requireOrganizationId } from '../middleware/organization-resolver.js';
import { requireRole } from '../middleware/require-role.js';
import { csvUuid, MAX_PAGE_SIZE, queryInt } from '../pagination.js';

/** Aggregates of one kind of subject (vehicles, drivers) for a scope. */
export interface RouteStatsQuery<Stats> {
  getStats(organizationId: string, scope: RouteStatsScope): Promise<readonly Stats[]>;
}

/** The module's `parseXOrThrow`, so invalid input becomes that module's typed 400. */
export type RouteStatsParser = <T>(schema: ZodType<T>, input: unknown, message: string) => T;

/** A real calendar day `YYYY-MM-DD` (`2026-02-30` is rejected). */
const plannedDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD day').refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'must be a real calendar day');

/**
 * `?months=1..12&from=YYYY-MM-DD&to=YYYY-MM-DD&ids=uuid,...`: `months` sizes the
 * monthly series, `from`/`to` (inclusive planned days, either may be open)
 * bound the totals and `ids` (at most one page) limits the subjects.
 */
export const routeStatsQuerySchema = z
  .strictObject({
    months: queryInt(1, MAX_ROUTE_STATS_MONTHS, DEFAULT_ROUTE_STATS_MONTHS),
    from: plannedDay.optional(),
    to: plannedDay.optional(),
    ids: csvUuid(MAX_PAGE_SIZE).optional(),
  })
  .refine(({ from, to }) => from === undefined || to === undefined || from <= to, {
    path: ['to'], message: 'must not be before from',
  })
  .transform(({ months, from, to, ids }): RouteStatsScope => ({
    months,
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(ids === undefined ? {} : { ids }),
  }));

/**
 * `GET /` of a route-stats router (`/vehicles/route-stats`, `/drivers/route-stats`).
 * Mount it before the catalog router, whose `/:id` would otherwise take `route-stats`.
 */
export function createRouteStatsRouter<Stats>(
  query: RouteStatsQuery<Stats>,
  authenticate: RequestHandler,
  parse: RouteStatsParser,
  invalidMessage: string,
): Router {
  const router = Router();

  router.get('/', authenticate, requireRole('ADMIN', 'DISPATCHER'), async (request, response) => {
    const scope = parse(routeStatsQuerySchema, request.query, invalidMessage);
    const stats = await query.getStats(requireOrganizationId(response), scope);
    response.json({ data: stats });
  });

  return router;
}
