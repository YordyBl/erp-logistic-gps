import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { monthKeys, VehicleRouteStatsTypeOrmQuery } from './VehicleRouteStatsTypeOrmQuery.js';

describe('VehicleRouteStatsTypeOrmQuery', () => {
  it('maps per-vehicle totals and fills the monthly series ending in the Lima month', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([
        { vehicle_id: 'vehicle-1', routes: '3', completed: 1, stops: '4', orders: 5, last_route_day: '2026-02-20' },
        { vehicle_id: 'vehicle-2', routes: 0, completed: 0, stops: 0, orders: 0, last_route_day: null },
      ])
      .mockResolvedValueOnce([
        { vehicle_id: 'vehicle-1', month: '2026-02', routes: '2' },
        { vehicle_id: 'vehicle-1', month: '2025-12', routes: 1 },
      ]);
    const stats = new VehicleRouteStatsTypeOrmQuery({ query } as unknown as Pick<DataSource, 'query'>);

    // 03:00 UTC on 1 March is still 28 February in Lima.
    const result = await stats.getStats('org-1', 3, new Date('2026-03-01T03:00:00.000Z'));

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
    expect(query.mock.calls[0]?.[1]).toEqual(['org-1']);
    expect(query.mock.calls[1]?.[1]).toEqual(['org-1', '2025-12-01', '2026-03-01']);

    const normalizedSql = query.mock.calls.map(([statement]) => String(statement).replace(/\s+/g, ' ').toLowerCase());
    // Every table is scoped to the tenant and cancelled routes never count.
    expect(normalizedSql[0]).toContain('from delivery_routes where organization_id=$1');
    expect(normalizedSql[0]).toContain('from delivery_stops where organization_id=$1');
    expect(normalizedSql[0]).toContain('from delivery_stop_orders where organization_id=$1');
    expect(normalizedSql[0]).toContain('where vehicles.organization_id=$1');
    for (const sql of normalizedSql) expect(sql).toContain(`status in ('planned', 'in_progress', 'completed')`);
  });

  it('defaults to six months', async () => {
    const query = vi.fn().mockResolvedValue([]);
    const stats = new VehicleRouteStatsTypeOrmQuery({ query } as unknown as Pick<DataSource, 'query'>);

    await expect(stats.getStats('org-1', undefined, new Date('2026-11-15T15:00:00.000Z'))).resolves.toEqual([]);
    expect(query.mock.calls[1]?.[1]).toEqual(['org-1', '2026-06-01', '2026-12-01']);
  });

  it('lists month keys across the year change', () => {
    expect(monthKeys('2026-11-09', 6)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(monthKeys('2027-02-01', 3)).toEqual(['2026-12', '2027-01', '2027-02']);
    expect(monthKeys('2026-01-31', 1)).toEqual(['2026-01']);
  });
});
