import type { RequestHandler } from 'express';
import type { Router } from 'express';

import type { DriverRouteStats } from '../../infrastructure/dispatch/DriverRouteStatsTypeOrmQuery.js';
import { parseDriverOrThrow } from '../validation.js';
import { createRouteStatsRouter, type RouteStatsQuery } from './route-stats.js';

export type DriverRouteStatsQuery = RouteStatsQuery<DriverRouteStats>;

/**
 * `GET /drivers/route-stats`: trips per driver (routes assigned to them,
 * optionally within a planned-day period and for some drivers) and a monthly
 * series for the drivers screen. Mounted before the driver catalog so
 * `route-stats` is not read as a driver id.
 */
export function createDriverRouteStatsRouter(
  query: DriverRouteStatsQuery,
  authenticate: RequestHandler,
): Router {
  return createRouteStatsRouter(query, authenticate, parseDriverOrThrow, 'Driver route stats query is invalid');
}
