import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import {
  DEFAULT_ROUTE_STATS_MONTHS, MAX_ROUTE_STATS_MONTHS, type VehicleRouteStats,
} from '../../infrastructure/dispatch/VehicleRouteStatsTypeOrmQuery.js';
import { requireOrganizationId } from '../middleware/organization-resolver.js';
import { requireRole } from '../middleware/require-role.js';
import { queryInt } from '../pagination.js';
import { parseVehicleOrThrow } from '../validation.js';

export interface VehicleRouteStatsQuery {
  getStats(organizationId: string, months: number): Promise<readonly VehicleRouteStats[]>;
}

const routeStatsQuerySchema = z.strictObject({
  months: queryInt(1, MAX_ROUTE_STATS_MONTHS, DEFAULT_ROUTE_STATS_MONTHS),
});

/**
 * `GET /vehicles/route-stats`: per-vehicle route totals and monthly series for
 * the fleet screen. Mounted before the vehicle catalog so `route-stats` is not
 * read as a vehicle id.
 */
export function createVehicleRouteStatsRouter(
  query: VehicleRouteStatsQuery,
  authenticate: RequestHandler,
): Router {
  const router = Router();

  router.get('/', authenticate, requireRole('ADMIN', 'DISPATCHER'), async (request, response) => {
    const { months } = parseVehicleOrThrow(routeStatsQuerySchema, request.query,
      'Vehicle route stats query is invalid');
    const stats = await query.getStats(requireOrganizationId(response), months);
    response.json({ data: stats });
  });

  return router;
}
