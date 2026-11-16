import type { RequestHandler } from 'express';
import type { Router } from 'express';

import type { VehicleRouteStats } from '../../infrastructure/dispatch/VehicleRouteStatsTypeOrmQuery.js';
import { parseVehicleOrThrow } from '../validation.js';
import { createRouteStatsRouter, type RouteStatsQuery } from './route-stats.js';

export type VehicleRouteStatsQuery = RouteStatsQuery<VehicleRouteStats>;

/**
 * `GET /vehicles/route-stats`: per-vehicle route totals (optionally within a
 * planned-day period and for some vehicles) and monthly series for the fleet
 * screen. Mounted before the vehicle catalog so `route-stats` is not read as a
 * vehicle id.
 */
export function createVehicleRouteStatsRouter(
  query: VehicleRouteStatsQuery,
  authenticate: RequestHandler,
): Router {
  return createRouteStatsRouter(query, authenticate, parseVehicleOrThrow, 'Vehicle route stats query is invalid');
}
