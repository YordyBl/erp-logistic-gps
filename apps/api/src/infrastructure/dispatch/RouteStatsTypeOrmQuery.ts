import type { DataSource } from 'typeorm';

import { limaDate } from './TrackingSnapshotTypeOrmQuery.js';

export const DEFAULT_ROUTE_STATS_MONTHS = 6;
export const MAX_ROUTE_STATS_MONTHS = 12;

/** Who the routes are grouped by: the vehicle or the driver assigned to each route. */
export type RouteStatsSubject = 'vehicle' | 'driver';

/** What to aggregate. Without `from`/`to` the totals cover every route; without `ids`, every subject. */
export interface RouteStatsScope {
  /** Length of the monthly series ending with the current Lima month (1..12, default 6). */
  readonly months?: number;
  /** First planned day (`YYYY-MM-DD`, inclusive) counted in the totals. */
  readonly from?: string;
  /** Last planned day (`YYYY-MM-DD`, inclusive) counted in the totals. */
  readonly to?: string;
  /** Only these subjects of the organization (another tenant's ids never match). */
  readonly ids?: readonly string[];
}

/** Route activity of one subject; only planned, in-progress and completed routes count. */
export interface SubjectRouteStats {
  readonly subjectId: string;
  /** Routes planned inside the period (all of them without one). */
  readonly routes: number;
  readonly completed: number;
  readonly stops: number;
  /** Order links of the subject's routes (a replanned order counts on every route it rode). */
  readonly orders: number;
  /** Planned day (`YYYY-MM-DD`) of the latest route ever, or `null` when it never had one. */
  readonly lastRouteDay: string | null;
  /** Routes per planned month (`YYYY-MM`), oldest first, ending with the current Lima month. */
  readonly monthly: readonly { readonly month: string; readonly routes: number }[];
}

/** Table and route column of each subject: fixed identifiers, never user input. */
const SUBJECTS: Readonly<Record<RouteStatsSubject, { readonly table: string; readonly column: string }>> = {
  vehicle: { table: 'vehicles', column: 'vehicle_id' },
  driver: { table: 'drivers', column: 'driver_id' },
};

interface TotalsRow {
  readonly subject_id: string;
  readonly routes: number | string;
  readonly completed: number | string;
  readonly stops: number | string;
  readonly orders: number | string;
  readonly last_route_day: string | null;
}

interface MonthlyRow {
  readonly subject_id: string;
  readonly month: string;
  readonly routes: number | string;
}

const LISTED_STATUSES = `('planned', 'in_progress', 'completed')`;

/**
 * Cross-module read model behind `GET /vehicles/route-stats` and
 * `GET /drivers/route-stats`: per-subject route totals over an optional period
 * and a monthly series, aggregated in SQL instead of shipping every route to
 * the browser. Every subject of the organization (or of `ids`) is present, with
 * zeros when it had no route.
 */
export class RouteStatsTypeOrmQuery {
  constructor(
    private readonly source: Pick<DataSource, 'query'>,
    private readonly subject: RouteStatsSubject,
  ) {}

  async getStats(
    organizationId: string, scope: RouteStatsScope = {}, now = new Date(),
  ): Promise<readonly SubjectRouteStats[]> {
    const { table, column } = SUBJECTS[this.subject];
    const keys = monthKeys(limaDate(now), scope.months ?? DEFAULT_ROUTE_STATS_MONTHS);
    const monthFrom = `${keys[0]}-01`;
    const monthUntil = `${nextMonth(keys[keys.length - 1]!)}-01`;
    const ids = scope.ids === undefined ? null : [...scope.ids];
    const [totals, monthly] = await Promise.all([
      this.source.query<TotalsRow[]>(
        `WITH listed AS (
           SELECT id, ${column} AS subject_id, status, planned_date FROM delivery_routes
           WHERE organization_id=$1 AND status IN ${LISTED_STATUSES}
         ), routes AS (
           SELECT * FROM listed
           WHERE ($2::date IS NULL OR planned_date >= $2::date) AND ($3::date IS NULL OR planned_date <= $3::date)
         ), last_days AS (
           SELECT subject_id, MAX(planned_date) AS last_route_day FROM listed GROUP BY subject_id
         ), stop_counts AS (
           SELECT route_id, COUNT(*) AS stops FROM delivery_stops
           WHERE organization_id=$1 AND route_id IN (SELECT id FROM routes) GROUP BY route_id
         ), order_counts AS (
           SELECT route_id, COUNT(*) AS orders FROM delivery_stop_orders
           WHERE organization_id=$1 AND route_id IN (SELECT id FROM routes) GROUP BY route_id
         )
         SELECT subjects.id AS subject_id,
                COUNT(routes.id)::integer AS routes,
                (COUNT(routes.id) FILTER (WHERE routes.status='completed'))::integer AS completed,
                COALESCE(SUM(stop_counts.stops), 0)::integer AS stops,
                COALESCE(SUM(order_counts.orders), 0)::integer AS orders,
                to_char(last_days.last_route_day, 'YYYY-MM-DD') AS last_route_day
         FROM ${table} subjects
         LEFT JOIN routes ON routes.subject_id=subjects.id
         LEFT JOIN stop_counts ON stop_counts.route_id=routes.id
         LEFT JOIN order_counts ON order_counts.route_id=routes.id
         LEFT JOIN last_days ON last_days.subject_id=subjects.id
         WHERE subjects.organization_id=$1 AND ($4::uuid[] IS NULL OR subjects.id = ANY($4::uuid[]))
         GROUP BY subjects.id, last_days.last_route_day
         ORDER BY subjects.id`, [organizationId, scope.from ?? null, scope.to ?? null, ids]),
      this.source.query<MonthlyRow[]>(
        `SELECT ${column} AS subject_id, to_char(planned_date, 'YYYY-MM') AS month, COUNT(*)::integer AS routes
         FROM delivery_routes
         WHERE organization_id=$1 AND status IN ${LISTED_STATUSES}
           AND planned_date >= $2::date AND planned_date < $3::date
           AND ($4::uuid[] IS NULL OR ${column} = ANY($4::uuid[]))
         GROUP BY ${column}, month`, [organizationId, monthFrom, monthUntil, ids]),
    ]);

    const monthlyBySubject = new Map<string, Map<string, number>>();
    for (const row of monthly) {
      const counts = monthlyBySubject.get(row.subject_id) ?? new Map<string, number>();
      counts.set(row.month, Number(row.routes));
      monthlyBySubject.set(row.subject_id, counts);
    }
    return totals.map((row) => {
      const counts = monthlyBySubject.get(row.subject_id);
      return {
        subjectId: row.subject_id,
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
