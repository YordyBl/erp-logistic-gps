import type { DataSource } from 'typeorm';

/** Number of weekly buckets in the series, ending with the week of `to`. */
export const REPORT_WEEKS = 8;
const ROW_LIMIT = 50;

export interface ReportPeriod {
  /** First day, `YYYY-MM-DD` in Lima. */
  readonly from: string;
  /** Last day (inclusive), `YYYY-MM-DD` in Lima. */
  readonly to: string;
}

/**
 * Raw counts of one period; the web derives the rates so every percentage can
 * be traced to its numerator and denominator.
 *
 * Attempts are «closed» when the driver confirmed the delivery (`delivered`)
 * or reported an incident (`failed`, the order is returned). A returned order
 * that is planned again gets a new attempt, so returns are counted from
 * attempts, not from the order's current status.
 */
export interface ReportKpis {
  /** Orders created in the period. */
  readonly orders: number;
  readonly closedAttempts: number;
  readonly delivered: number;
  readonly returned: number;
  readonly firstAttempts: number;
  readonly firstAttemptDelivered: number;
  /** Mean time between consecutive stop closures of a route (the first from the route start). */
  readonly avgStopSeconds: number | null;
  readonly timedStops: number;
  /** Simulator completions in the period, counted whether or not they are included. */
  readonly simulatedAttempts: number;
}

export interface ReportWeek {
  /** Monday of the week, `YYYY-MM-DD`. */
  readonly weekStart: string;
  readonly delivered: number;
  readonly returned: number;
  readonly cancelled: number;
}

export interface ReportBreakdown {
  readonly firstAttempts: number;
  readonly firstAttemptDelivered: number;
  readonly closedAttempts: number;
  readonly returned: number;
}

export interface ReportDistrict extends ReportBreakdown {
  readonly district: string;
  /** Distinct orders with a closed attempt in the period. */
  readonly orders: number;
}

export interface ReportDriver extends ReportBreakdown {
  readonly driverId: string;
  readonly fullName: string;
  /** Distinct routes with a closed attempt in the period. */
  readonly routes: number;
  readonly deliveries: number;
}

export interface OperationsReport {
  readonly period: ReportPeriod;
  readonly comparison: ReportPeriod | null;
  readonly includeSimulated: boolean;
  readonly kpis: ReportKpis;
  readonly comparisonKpis: ReportKpis | null;
  readonly weekly: readonly ReportWeek[];
  readonly incidents: readonly { readonly category: string; readonly count: number }[];
  readonly districts: readonly ReportDistrict[];
  readonly drivers: readonly ReportDriver[];
}

export interface OperationsReportRequest {
  readonly period: ReportPeriod;
  readonly comparison: ReportPeriod | null;
  readonly includeSimulated: boolean;
}

type Count = number | string;

/** `[since, until)` of a Lima date range as timestamptz bounds; `$a`/`$b` are its parameters. */
const range = (column: string, from: string, to: string) =>
  `${column} >= (${from}::date)::timestamp AT TIME ZONE 'America/Lima' AND ${column} < (${to}::date + 1)::timestamp AT TIME ZONE 'America/Lima'`;

const SIMULATED = `COALESCE(a.delivery_notes, '') LIKE 'SIMULATED:%'`;

/** Closed attempts of `$1` between `$2` and `$3`; `$4` includes simulator completions. */
const CLOSED_ATTEMPTS = `closed AS (
  SELECT a.* FROM delivery_attempts a
  WHERE a.organization_id=$1 AND a.status IN ('delivered', 'failed')
    AND ${range('a.completed_at', '$2', '$3')}
    AND ($4::boolean OR NOT ${SIMULATED})
)`;

const BREAKDOWN = `COUNT(*) FILTER (WHERE c.attempt_number=1)::integer AS first_attempts,
  COUNT(*) FILTER (WHERE c.attempt_number=1 AND c.status='delivered')::integer AS first_attempt_delivered,
  COUNT(*)::integer AS closed_attempts,
  COUNT(*) FILTER (WHERE c.status='failed')::integer AS returned`;

interface KpiRow {
  readonly orders: Count; readonly closed_attempts: Count; readonly delivered: Count; readonly returned: Count;
  readonly first_attempts: Count; readonly first_attempt_delivered: Count; readonly simulated_attempts: Count;
}
interface StopTimeRow { readonly avg_seconds: number | string | null; readonly timed_stops: Count }
interface BreakdownRow {
  readonly first_attempts: Count; readonly first_attempt_delivered: Count; readonly closed_attempts: Count; readonly returned: Count;
}
interface DistrictRow extends BreakdownRow { readonly district: string; readonly orders: Count }
interface DriverRow extends BreakdownRow {
  readonly driver_id: string; readonly full_name: string; readonly routes: Count; readonly deliveries: Count;
}

/**
 * Cross-module read model behind `GET /reports/operations`: period KPIs with
 * an optional comparison period, an eight-week outcome series, incidents by
 * category and breakdowns by district and driver, aggregated in SQL.
 *
 * Simulator completions (`delivery_notes` starting with `SIMULATED:`) are left
 * out unless asked for, so a demo never mixes into real figures silently; their
 * count is always returned so the screen can offer to include them.
 */
export class OperationsReportTypeOrmQuery {
  constructor(private readonly source: Pick<DataSource, 'query'>) {}

  async getReport(organizationId: string, request: OperationsReportRequest): Promise<OperationsReport> {
    const { period, comparison, includeSimulated } = request;
    const weeks = weekStarts(period.to, REPORT_WEEKS);
    const [kpis, comparisonKpis, weekly, incidents, districts, drivers] = await Promise.all([
      this.kpis(organizationId, period, includeSimulated),
      comparison === null ? Promise.resolve(null) : this.kpis(organizationId, comparison, includeSimulated),
      this.weekly(organizationId, weeks, period.to, includeSimulated),
      this.source.query<{ category: string; count: Count }[]>(
        `SELECT category, COUNT(*)::integer AS count FROM delivery_incidents i
         WHERE i.organization_id=$1 AND ${range('i.occurred_at', '$2', '$3')}
         GROUP BY category ORDER BY count DESC, category`,
        [organizationId, period.from, period.to]),
      this.source.query<DistrictRow[]>(
        `WITH ${CLOSED_ATTEMPTS}
         SELECT MIN(trim(o.delivery_district)) AS district, COUNT(DISTINCT c.order_id)::integer AS orders, ${BREAKDOWN}
         FROM closed c JOIN delivery_orders o ON o.organization_id=c.organization_id AND o.id=c.order_id
         GROUP BY lower(trim(o.delivery_district))
         ORDER BY orders DESC, district LIMIT ${ROW_LIMIT}`,
        [organizationId, period.from, period.to, includeSimulated]),
      this.source.query<DriverRow[]>(
        `WITH ${CLOSED_ATTEMPTS}
         SELECT d.id AS driver_id, d.full_name, COUNT(DISTINCT c.route_id)::integer AS routes,
                COUNT(*) FILTER (WHERE c.status='delivered')::integer AS deliveries, ${BREAKDOWN}
         FROM closed c JOIN drivers d ON d.organization_id=c.organization_id AND d.id=c.driver_id
         GROUP BY d.id, d.full_name
         ORDER BY deliveries DESC, d.full_name LIMIT ${ROW_LIMIT}`,
        [organizationId, period.from, period.to, includeSimulated]),
    ]);

    return {
      period,
      comparison,
      includeSimulated,
      kpis,
      comparisonKpis,
      weekly,
      incidents: incidents.map((row) => ({ category: row.category, count: Number(row.count) })),
      districts: districts.map((row) => ({ district: row.district, orders: Number(row.orders), ...breakdown(row) })),
      drivers: drivers.map((row) => ({
        driverId: row.driver_id, fullName: row.full_name, routes: Number(row.routes), deliveries: Number(row.deliveries), ...breakdown(row),
      })),
    };
  }

  private async kpis(organizationId: string, period: ReportPeriod, includeSimulated: boolean): Promise<ReportKpis> {
    const parameters = [organizationId, period.from, period.to, includeSimulated];
    const [[counts], [stops]] = await Promise.all([
      this.source.query<KpiRow[]>(
        `WITH ${CLOSED_ATTEMPTS}
         SELECT
           (SELECT COUNT(*) FROM delivery_orders o WHERE o.organization_id=$1 AND ${range('o.created_at', '$2', '$3')})::integer AS orders,
           (SELECT COUNT(*) FROM closed)::integer AS closed_attempts,
           (SELECT COUNT(*) FROM closed WHERE status='delivered')::integer AS delivered,
           (SELECT COUNT(*) FROM closed WHERE status='failed')::integer AS returned,
           (SELECT COUNT(*) FROM closed WHERE attempt_number=1)::integer AS first_attempts,
           (SELECT COUNT(*) FROM closed WHERE attempt_number=1 AND status='delivered')::integer AS first_attempt_delivered,
           (SELECT COUNT(*) FROM delivery_attempts a WHERE a.organization_id=$1 AND a.status IN ('delivered', 'failed')
              AND ${range('a.completed_at', '$2', '$3')} AND ${SIMULATED})::integer AS simulated_attempts`,
        parameters),
      this.source.query<StopTimeRow[]>(
        `WITH ${CLOSED_ATTEMPTS}, stop_closes AS (
           SELECT c.route_id, so.stop_id, MAX(c.completed_at) AS closed_at
           FROM closed c
           JOIN delivery_stop_orders so ON so.organization_id=c.organization_id AND so.route_id=c.route_id AND so.order_id=c.order_id
           GROUP BY c.route_id, so.stop_id
         ), gaps AS (
           SELECT sc.closed_at - COALESCE(LAG(sc.closed_at) OVER (PARTITION BY sc.route_id ORDER BY sc.closed_at), r.started_at) AS gap
           FROM stop_closes sc JOIN delivery_routes r ON r.organization_id=$1 AND r.id=sc.route_id
         )
         SELECT AVG(EXTRACT(EPOCH FROM gap))::float AS avg_seconds, COUNT(*)::integer AS timed_stops
         FROM gaps WHERE gap IS NOT NULL AND gap >= interval '0'`,
        parameters),
    ]);

    return {
      orders: Number(counts?.orders ?? 0),
      closedAttempts: Number(counts?.closed_attempts ?? 0),
      delivered: Number(counts?.delivered ?? 0),
      returned: Number(counts?.returned ?? 0),
      firstAttempts: Number(counts?.first_attempts ?? 0),
      firstAttemptDelivered: Number(counts?.first_attempt_delivered ?? 0),
      avgStopSeconds: stops?.avg_seconds === null || stops?.avg_seconds === undefined ? null : Math.round(Number(stops.avg_seconds)),
      timedStops: Number(stops?.timed_stops ?? 0),
      simulatedAttempts: Number(counts?.simulated_attempts ?? 0),
    };
  }

  private async weekly(
    organizationId: string, weeks: readonly string[], to: string, includeSimulated: boolean,
  ): Promise<readonly ReportWeek[]> {
    const from = weeks[0]!;
    const [outcomes, cancellations] = await Promise.all([
      this.source.query<{ week: string; delivered: Count; returned: Count }[]>(
        `WITH ${CLOSED_ATTEMPTS}
         SELECT to_char(date_trunc('week', c.completed_at AT TIME ZONE 'America/Lima'), 'YYYY-MM-DD') AS week,
                COUNT(*) FILTER (WHERE c.status='delivered')::integer AS delivered,
                COUNT(*) FILTER (WHERE c.status='failed')::integer AS returned
         FROM closed c GROUP BY 1`,
        [organizationId, from, to, includeSimulated]),
      this.source.query<{ week: string; cancelled: Count }[]>(
        `SELECT to_char(date_trunc('week', h.occurred_at AT TIME ZONE 'America/Lima'), 'YYYY-MM-DD') AS week,
                COUNT(*)::integer AS cancelled
         FROM delivery_order_status_history h
         WHERE h.organization_id=$1 AND h.to_status='cancelled' AND ${range('h.occurred_at', '$2', '$3')}
         GROUP BY 1`,
        [organizationId, from, to]),
    ]);
    const outcomeByWeek = new Map(outcomes.map((row) => [row.week, row]));
    const cancelledByWeek = new Map(cancellations.map((row) => [row.week, Number(row.cancelled)]));
    return weeks.map((weekStart) => ({
      weekStart,
      delivered: Number(outcomeByWeek.get(weekStart)?.delivered ?? 0),
      returned: Number(outcomeByWeek.get(weekStart)?.returned ?? 0),
      cancelled: cancelledByWeek.get(weekStart) ?? 0,
    }));
  }
}

function breakdown(row: BreakdownRow): ReportBreakdown {
  return {
    firstAttempts: Number(row.first_attempts),
    firstAttemptDelivered: Number(row.first_attempt_delivered),
    closedAttempts: Number(row.closed_attempts),
    returned: Number(row.returned),
  };
}

/** Mondays (`YYYY-MM-DD`) of the `count` weeks ending with the week of `lastDay`, oldest first. */
export function weekStarts(lastDay: string, count: number): readonly string[] {
  const [year, month, day] = lastDay.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(year, month - 1, day));
  const mondayOffset = (last.getUTCDay() + 6) % 7;
  const lastMonday = Date.UTC(year, month - 1, day - mondayOffset);
  return Array.from({ length: count }, (_, index) =>
    new Date(lastMonday - (count - 1 - index) * 7 * 86_400_000).toISOString().slice(0, 10));
}
