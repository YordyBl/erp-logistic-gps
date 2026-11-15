import type { DataSource } from 'typeorm';

import { limaDate } from './TrackingSnapshotTypeOrmQuery.js';

export const DEFAULT_ROUTE_STATS_MONTHS = 6;
export const MAX_ROUTE_STATS_MONTHS = 12;

/** Route activity of one vehicle; only planned, in-progress and completed routes count. */
export interface VehicleRouteStats {
  readonly vehicleId: string;
  readonly routes: number;
  readonly completed: number;
  readonly stops: number;
  /** Order links of the vehicle's routes (a replanned order counts on every route it rode). */
  readonly orders: number;
  /** Planned day (`YYYY-MM-DD`) of the latest route, or `null` when the vehicle never had one. */
  readonly lastRouteDay: string | null;
  /** Routes per planned month (`YYYY-MM`), oldest first, ending with the current Lima month. */
  readonly monthly: readonly { readonly month: string; readonly routes: number }[];
}

interface TotalsRow {
  readonly vehicle_id: string;
  readonly routes: number | string;
  readonly completed: number | string;
  readonly stops: number | string;
  readonly orders: number | string;
  readonly last_route_day: string | null;
}

interface MonthlyRow {
  readonly vehicle_id: string;
  readonly month: string;
  readonly routes: number | string;
}

const LISTED_STATUSES = `('planned', 'in_progress', 'completed')`;

/**
 * Cross-module read model behind `GET /vehicles/route-stats`: per-vehicle
 * route totals and a monthly series, aggregated in SQL instead of shipping
 * every route to the browser. Every vehicle of the organization is present,
 * with zeros when it never had a route.
 */
export class VehicleRouteStatsTypeOrmQuery {
  constructor(private readonly source: Pick<DataSource, 'query'>) {}

  async getStats(
    organizationId: string, months = DEFAULT_ROUTE_STATS_MONTHS, now = new Date(),
  ): Promise<readonly VehicleRouteStats[]> {
    const keys = monthKeys(limaDate(now), months);
    const from = `${keys[0]}-01`;
    const until = `${nextMonth(keys[keys.length - 1]!)}-01`;
    const [totals, monthly] = await Promise.all([
      this.source.query<TotalsRow[]>(
        `WITH routes AS (
           SELECT id, vehicle_id, status, planned_date FROM delivery_routes
           WHERE organization_id=$1 AND status IN ${LISTED_STATUSES}
         ), stop_counts AS (
           SELECT route_id, COUNT(*) AS stops FROM delivery_stops
           WHERE organization_id=$1 AND route_id IN (SELECT id FROM routes) GROUP BY route_id
         ), order_counts AS (
           SELECT route_id, COUNT(*) AS orders FROM delivery_stop_orders
           WHERE organization_id=$1 AND route_id IN (SELECT id FROM routes) GROUP BY route_id
         )
         SELECT vehicles.id AS vehicle_id,
                COUNT(routes.id)::integer AS routes,
                (COUNT(routes.id) FILTER (WHERE routes.status='completed'))::integer AS completed,
                COALESCE(SUM(stop_counts.stops), 0)::integer AS stops,
                COALESCE(SUM(order_counts.orders), 0)::integer AS orders,
                to_char(MAX(routes.planned_date), 'YYYY-MM-DD') AS last_route_day
         FROM vehicles
         LEFT JOIN routes ON routes.vehicle_id=vehicles.id
         LEFT JOIN stop_counts ON stop_counts.route_id=routes.id
         LEFT JOIN order_counts ON order_counts.route_id=routes.id
         WHERE vehicles.organization_id=$1
         GROUP BY vehicles.id
         ORDER BY vehicles.id`, [organizationId]),
      this.source.query<MonthlyRow[]>(
        `SELECT vehicle_id, to_char(planned_date, 'YYYY-MM') AS month, COUNT(*)::integer AS routes
         FROM delivery_routes
         WHERE organization_id=$1 AND status IN ${LISTED_STATUSES}
           AND planned_date >= $2::date AND planned_date < $3::date
         GROUP BY vehicle_id, month`, [organizationId, from, until]),
    ]);

    const monthlyByVehicle = new Map<string, Map<string, number>>();
    for (const row of monthly) {
      const counts = monthlyByVehicle.get(row.vehicle_id) ?? new Map<string, number>();
      counts.set(row.month, Number(row.routes));
      monthlyByVehicle.set(row.vehicle_id, counts);
    }
    return totals.map((row) => {
      const counts = monthlyByVehicle.get(row.vehicle_id);
      return {
        vehicleId: row.vehicle_id,
        routes: Number(row.routes),
        completed: Number(row.completed),
        stops: Number(row.stops),
        orders: Number(row.orders),
        lastRouteDay: row.last_route_day,
        monthly: keys.map((month) => ({ month, routes: counts?.get(month) ?? 0 })),
      };
    });
  }
}

/** The `months` month keys (`YYYY-MM`) ending with the month of `today` (`YYYY-MM-DD`). */
export function monthKeys(today: string, months: number): readonly string[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return Array.from({ length: months }, (_, index) =>
    new Date(Date.UTC(year, month - 1 - (months - 1 - index), 1)).toISOString().slice(0, 7));
}

function nextMonth(key: string): string {
  const date = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 1));
  return date.toISOString().slice(0, 7);
}
