import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { DispatchDashboardTypeOrmQuery } from './DispatchDashboardTypeOrmQuery.js';

describe('DispatchDashboardTypeOrmQuery', () => {
  it('aggregates tenant data and uses the America/Lima day boundary', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([
        { status: 'created', count: '2' }, { status: 'returned', count: '1' },
        { status: 'in_transit', count: '3' }, { status: 'delivered', count: '4' },
      ])
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ count: '4' }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{
        id: 'order-1', public_code: 'LIM-001', status: 'in_transit',
        created_at: new Date('2026-11-02T12:00:00.000Z'),
      }])
      .mockResolvedValueOnce([{
        id: 'incident-1', order_id: 'order-2', public_code: 'LIM-002', category: 'recipient_absent',
        description: 'No había nadie.', occurred_at: '2026-11-02T13:00:00.000Z',
      }])
      .mockResolvedValueOnce([{
        id: 'route-1', public_code: 'R-001', planned_date: '2026-11-02',
        latitude: '-12.05', longitude: '-77.04', received_at: '2026-11-02T13:30:00.000Z',
      }]);
    const source = { query } as unknown as Pick<DataSource, 'query'>;
    const dashboard = new DispatchDashboardTypeOrmQuery(source);

    const result = await dashboard.getSummary('org-1', new Date('2026-11-03T04:30:00.000Z'));

    expect(result).toMatchObject({
      ordersAwaitingPlanning: 3,
      routesInProgress: 2,
      deliveriesToday: 4,
      incidentsToday: 1,
      orderStatusCounts: { created: 2, returned: 1, in_transit: 3, delivered: 4, planned: 0 },
      recentOrders: [{ id: 'order-1', publicCode: 'LIM-001', createdAt: '2026-11-02T12:00:00.000Z' }],
      recentIncidents: [{ id: 'incident-1', orderId: 'order-2', publicCode: 'LIM-002',
        occurredAt: '2026-11-02T13:00:00.000Z' }],
      activeRoutes: [{ id: 'route-1', publicCode: 'R-001', plannedDate: '2026-11-02',
        lastPosition: { latitude: -12.05, longitude: -77.04, receivedAt: '2026-11-02T13:30:00.000Z' } }],
    });
    expect(query).toHaveBeenCalledTimes(7);
    const dailyQueries = query.mock.calls.filter(([sql]) => String(sql).includes('completed_at >= $2') ||
      String(sql).includes('occurred_at >= $2'));
    expect(dailyQueries).toHaveLength(2);
    for (const [, parameters] of dailyQueries) {
      expect(parameters).toEqual([
        'org-1', new Date('2026-11-02T05:00:00.000Z'), new Date('2026-11-03T05:00:00.000Z'),
      ]);
    }
    expect(query.mock.calls.every(([, parameters]) => parameters?.[0] === 'org-1')).toBe(true);

    const normalizedSql = query.mock.calls.map(([statement]) =>
      String(statement).replace(/\s+/g, ' ').toLowerCase());
    for (const sql of normalizedSql) {
      expect(sql).toMatch(/where .*organization_id\s*=\s*\$1/);
    }
    expect(normalizedSql[5]).toContain('orders.organization_id=incidents.organization_id');
    expect(normalizedSql[5]).toContain('orders.id=incidents.order_id');
    expect(normalizedSql[6]).toContain(
      'where organization_id=routes.organization_id and route_id=routes.id',
    );
  });
});
