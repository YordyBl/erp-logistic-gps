import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { OperationsReportTypeOrmQuery, weekStarts } from './OperationsReportTypeOrmQuery.js';

const normalize = (sql: unknown) => String(sql).replace(/\s+/g, ' ').toLowerCase();

/** Answers each statement by what it reads, so the parallel order of calls does not matter. */
function fakeSource(rows: {
  kpis?: object[]; stops?: object[]; weekly?: object[]; cancelled?: object[]; incidents?: object[]; districts?: object[]; drivers?: object[];
}) {
  return vi.fn(async (sql: string) => {
    const text = normalize(sql);
    if (text.includes('as simulated_attempts')) return rows.kpis ?? [];
    if (text.includes('stop_closes')) return rows.stops ?? [];
    if (text.includes("to_status='cancelled'")) return rows.cancelled ?? [];
    if (text.includes("date_trunc('week'")) return rows.weekly ?? [];
    if (text.includes('from delivery_incidents')) return rows.incidents ?? [];
    if (text.includes('delivery_district')) return rows.districts ?? [];
    if (text.includes('join drivers')) return rows.drivers ?? [];
    throw new Error(`unexpected statement: ${text.slice(0, 80)}`);
  });
}

describe('OperationsReportTypeOrmQuery', () => {
  it('maps the period, its comparison, the weekly series and the breakdowns', async () => {
    const query = fakeSource({
      kpis: [{ orders: '12', closed_attempts: 10, delivered: '8', returned: 2, first_attempts: 9, first_attempt_delivered: '7', simulated_attempts: 3 }],
      stops: [{ avg_seconds: '659.6', timed_stops: 6 }],
      weekly: [{ week: '2026-11-16', delivered: '5', returned: 1 }],
      cancelled: [{ week: '2026-11-09', cancelled: '2' }],
      incidents: [{ category: 'recipient_absent', count: '2' }],
      districts: [{ district: 'Miraflores', orders: '6', first_attempts: 6, first_attempt_delivered: 5, closed_attempts: 6, returned: 1 }],
      drivers: [{ driver_id: 'driver-1', full_name: 'María Rojas', routes: '2', deliveries: 5, first_attempts: 6, first_attempt_delivered: 5, closed_attempts: 6, returned: 1 }],
    });
    const reports = new OperationsReportTypeOrmQuery({ query } as unknown as Pick<DataSource, 'query'>);

    const report = await reports.getReport('org-1', {
      period: { from: '2026-11-01', to: '2026-11-18' },
      comparison: { from: '2026-10-01', to: '2026-10-18' },
      includeSimulated: false,
    });

    expect(report.kpis).toEqual({
      orders: 12, closedAttempts: 10, delivered: 8, returned: 2, firstAttempts: 9, firstAttemptDelivered: 7,
      avgStopSeconds: 660, timedStops: 6, simulatedAttempts: 3,
    });
    expect(report.comparisonKpis?.orders).toBe(12);
    expect(report.weekly).toHaveLength(8);
    expect(report.weekly.at(-1)).toEqual({ weekStart: '2026-11-16', delivered: 5, returned: 1, cancelled: 0 });
    expect(report.weekly.at(-2)).toEqual({ weekStart: '2026-11-09', delivered: 0, returned: 0, cancelled: 2 });
    expect(report.incidents).toEqual([{ category: 'recipient_absent', count: 2 }]);
    expect(report.districts).toEqual([{ district: 'Miraflores', orders: 6, firstAttempts: 6, firstAttemptDelivered: 5, closedAttempts: 6, returned: 1 }]);
    expect(report.drivers).toEqual([{ driverId: 'driver-1', fullName: 'María Rojas', routes: 2, deliveries: 5, firstAttempts: 6, firstAttemptDelivered: 5, closedAttempts: 6, returned: 1 }]);

    // Both periods are read; the series starts seven Mondays before the last one.
    const parameters = query.mock.calls.map((call) => (call as unknown as [string, unknown[]])[1]);
    expect(parameters).toContainEqual(['org-1', '2026-11-01', '2026-11-18', false]);
    expect(parameters).toContainEqual(['org-1', '2026-10-01', '2026-10-18', false]);
    expect(parameters).toContainEqual(['org-1', '2026-09-28', '2026-11-18', false]);
    expect(parameters).toContainEqual(['org-1', '2026-11-01', '2026-11-18']);

    for (const [sql] of query.mock.calls) {
      const text = normalize(sql);
      // Every statement is scoped to the tenant and reads Lima calendar days.
      expect(text).toContain('organization_id=$1');
      expect(text).toContain("at time zone 'america/lima'");
    }
  });

  it('returns empty figures and no comparison when nothing closed', async () => {
    const query = fakeSource({ kpis: [{ orders: 0, closed_attempts: 0, delivered: 0, returned: 0, first_attempts: 0, first_attempt_delivered: 0, simulated_attempts: 0 }], stops: [{ avg_seconds: null, timed_stops: 0 }] });
    const reports = new OperationsReportTypeOrmQuery({ query } as unknown as Pick<DataSource, 'query'>);

    const report = await reports.getReport('org-1', { period: { from: '2026-11-12', to: '2026-11-18' }, comparison: null, includeSimulated: true });

    expect(report.comparisonKpis).toBeNull();
    expect(report.kpis.avgStopSeconds).toBeNull();
    expect(report.weekly.every((week) => week.delivered === 0 && week.returned === 0 && week.cancelled === 0)).toBe(true);
    expect(query.mock.calls.some((call) => (call as unknown as [string, unknown[]])[1].at(-1) === true)).toBe(true);
  });

  it('excludes simulator completions unless asked', async () => {
    const query = fakeSource({});
    const reports = new OperationsReportTypeOrmQuery({ query } as unknown as Pick<DataSource, 'query'>);

    await reports.getReport('org-1', { period: { from: '2026-11-12', to: '2026-11-18' }, comparison: null, includeSimulated: false });

    const closed = query.mock.calls.map(([sql]) => normalize(sql)).filter((text) => text.includes('with closed as'));
    expect(closed.length).toBeGreaterThan(0);
    for (const text of closed) expect(text).toContain("($4::boolean or not coalesce(a.delivery_notes, '') like 'simulated:%')");
  });

  it('lists Mondays across month and year changes', () => {
    expect(weekStarts('2026-11-18', 3)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
    expect(weekStarts('2026-11-16', 1)).toEqual(['2026-11-16']);
    expect(weekStarts('2026-11-22', 1)).toEqual(['2026-11-16']);
    expect(weekStarts('2027-01-03', 2)).toEqual(['2026-12-21', '2026-12-28']);
  });
});
