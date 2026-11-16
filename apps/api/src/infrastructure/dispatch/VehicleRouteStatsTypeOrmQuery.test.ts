import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { DriverRouteStatsTypeOrmQuery } from './DriverRouteStatsTypeOrmQuery.js';
import { monthKeys, VehicleRouteStatsTypeOrmQuery } from './VehicleRouteStatsTypeOrmQuery.js';

const normalize = (statement: unknown) => String(statement).replace(/\s+/g, ' ').toLowerCase();

describe('VehicleRouteStatsTypeOrmQuery', () => {
  it('maps per-vehicle totals and fills the monthly series ending in the Lima month', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([
        { subject_id: 'vehicle-1', routes: '3', completed: 1, stops: '4', orders: 5, last_route_day: '2026-02-20' },
        { subject_id: 'vehicle-2', routes: 0, completed: 0, stops: 0, orders: 0, last_route_day: null },
      ])
      .mockResolvedValueOnce([
        { subject_id: 'vehicle-1', month: '2026-02', routes: '2' },
        { subject_id: 'vehicle-1', month: '2025-12', routes: 1 },
      ]);
    const stats = new VehicleRouteStatsTypeOrmQuery({ query } as unknown as Pick<DataSource, 'query'>);

    // 03:00 UTC on 1 March is still 28 February in Lima.
    const result = await stats.getStats('org-1', { months: 3 }, new Date('2026-03-01T03:00:00.000Z'));

    expect(result).toEqual([
      {
        vehicleId: 'vehicle-1', routes: 3, completed: 1, stops: 4, orders: 5, lastRouteDay: '2026-02-20',
        monthly: [{ month: '2025-12', routes: 1 }, { month: '2026-01', routes: 0 }, { month: '2026-02', routes: 2 }],
      },
      {
        vehicleId: 'vehicle-2', routes: 0, completed: 0, stops: 0, orders: 0, lastRouteDay: null,
        monthly: [{ month: '2025-12', routes: 0 }, { month: '2026-01', routes: 0 }, { month: '2026-02', routes: 0 }],
      },
    ]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]).toEqual(['org-1', null, null, null]);
    expect(query.mock.calls[1]?.[1]).toEqual(['org-1', '2025-12-01', '2026-03-01', null]);

    const normalizedSql = query.mock.calls.map(([statement]) => normalize(statement));
    // Every table is scoped to the tenant and cancelled routes never count.
    expect(normalizedSql[0]).toContain('from delivery_routes where organization_id=$1');
    expect(normalizedSql[0]).toContain('from delivery_stops where organization_id=$1');
    expect(normalizedSql[0]).toContain('from delivery_stop_orders where organization_id=$1');
    expect(normalizedSql[0]).toContain('from vehicles subjects');
    expect(normalizedSql[0]).toContain('where subjects.organization_id=$1');
    for (const sql of normalizedSql) {
      expect(sql).toContain(`status in ('planned', 'in_progress', 'completed')`);
      expect(sql).toContain('vehicle_id');
      expect(sql).not.toContain('driver_id');
    }
  });

  it('defaults to six months', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const stats = new VehicleRouteStatsTypeOrmQuery({ query } as unknown as Pick<DataSource, 'query'>);

    await expect(stats.getStats('org-1', {}, new Date('2026-11-15T15:00:00.000Z'))).resolves.toEqual([]);
    expect(query.mock.calls[1]?.[1]).toEqual(['org-1', '2026-06-01', '2026-12-01', null]);
  });

  it('passes the period and the subject ids; the period limits the totals, not the last route day', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const stats = new VehicleRouteStatsTypeOrmQuery({ query } as unknown as Pick<DataSource, 'query'>);

    await stats.getStats('org-1', { months: 2, from: '2026-11-01', to: '2026-11-30', ids: ['v-1', 'v-2'] },
      new Date('2026-11-15T15:00:00.000Z'));

    expect(query.mock.calls[0]?.[1]).toEqual(['org-1', '2026-11-01', '2026-11-30', ['v-1', 'v-2']]);
    // With a period the monthly bars are the months of the period, not `months` ending today.
    expect(query.mock.calls[1]?.[1]).toEqual(['org-1', '2026-11-01', '2026-12-01', ['v-1', 'v-2']]);
    const [totals, monthly] = query.mock.calls.map(([statement]) => normalize(statement));
    expect(totals).toContain('planned_date >= $2::date');
    expect(totals).toContain('planned_date <= $3::date');
    // The last route day reads every listed route, outside the period too.
    expect(totals).toMatch(/max\(planned_date\) as last_route_day from listed/);
    expect(totals).toContain('subjects.id = any($4::uuid[])');
    expect(monthly).toContain('vehicle_id = any($4::uuid[])');
  });

  it('builds one monthly bar per month of the period, the last twelve when longer', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ subject_id: 'v-1', routes: 1, completed: 1, stops: 1, orders: 1, last_route_day: '2026-03-02' }])
      .mockResolvedValueOnce([{ subject_id: 'v-1', month: '2026-03', routes: 1 }])
      .mockResolvedValue([]);
    const stats = new VehicleRouteStatsTypeOrmQuery({ query } as unknown as Pick<DataSource, 'query'>);
    const now = new Date('2026-11-16T15:00:00.000Z');

    const year = await stats.getStats('org-1', { months: 6, from: '2026-01-01', to: '2026-12-31' }, now);
    expect(year[0]?.monthly.map((item) => item.month)).toEqual([
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
      '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
    ]);
    expect(year[0]?.monthly.find((item) => item.month === '2026-03')?.routes).toBe(1);
    expect(query.mock.calls[1]?.[1]).toEqual(['org-1', '2026-01-01', '2027-01-01', null]);

    await stats.getStats('org-1', { from: '2024-05-10', to: '2026-02-03' }, now);
    expect(query.mock.calls[3]?.[1]).toEqual(['org-1', '2025-03-01', '2026-03-01', null]);

    // An open-ended period keeps `months` ending in the current month.
    await stats.getStats('org-1', { months: 2, from: '2026-01-01' }, now);
    expect(query.mock.calls[5]?.[1]).toEqual(['org-1', '2026-10-01', '2026-12-01', null]);
  });

  it('lists month keys across the year change', () => {
    expect(monthKeys('2026-11-09', 6)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(monthKeys('2027-02-01', 3)).toEqual(['2026-12', '2027-01', '2027-02']);
    expect(monthKeys('2026-01-31', 1)).toEqual(['2026-01']);
  });
});

describe('DriverRouteStatsTypeOrmQuery', () => {
  it('aggregates the same way by driver', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([
        { subject_id: 'driver-1', routes: 2, completed: 1, stops: 3, orders: 4, last_route_day: '2026-11-06' },
      ])
      .mockResolvedValueOnce([{ subject_id: 'driver-1', month: '2026-11', routes: 2 }]);
    const stats = new DriverRouteStatsTypeOrmQuery({ query } as unknown as Pick<DataSource, 'query'>);

    const result = await stats.getStats('org-1', { months: 1 }, new Date('2026-11-15T15:00:00.000Z'));

    expect(result).toEqual([{
      driverId: 'driver-1', routes: 2, completed: 1, stops: 3, orders: 4, lastRouteDay: '2026-11-06',
      monthly: [{ month: '2026-11', routes: 2 }],
    }]);
    const normalizedSql = query.mock.calls.map(([statement]) => normalize(statement));
    expect(normalizedSql[0]).toContain('from drivers subjects');
    for (const sql of normalizedSql) {
      expect(sql).toContain('driver_id');
      expect(sql).not.toContain('vehicle_id');
    }
  });
});
