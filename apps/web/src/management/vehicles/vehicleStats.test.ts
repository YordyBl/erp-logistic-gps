import { describe, expect, it } from 'vitest';

import type { DispatchRoute } from '../../api/client.js';
import { groupRoutesByVehicle, monthlyRoutes, summarizeVehicleRoutes, todayInLima, vehicleKind } from './vehicleStats.js';

function route(id: string, vehicleId: string, plannedDate: string, status: DispatchRoute['status'], orders: number[]): DispatchRoute {
  return {
    id, organizationId: 'org-1', publicCode: id.toUpperCase(), plannedDate, driverId: 'driver-1', vehicleId, status,
    createdAt: plannedDate,
    stops: orders.map((count, index) => ({
      id: `${id}-stop-${index}`, sequence: index + 1, addressLine: 'Av. Arequipa 100', latitude: null, longitude: null,
      orderIds: Array.from({ length: count }, (_, order) => `${id}-order-${index}-${order}`),
    })),
  };
}

const routes = [
  route('r1', 'v1', '2026-09-10T05:00:00.000Z', 'completed', [2, 1]),
  route('r2', 'v1', '2026-11-06T05:00:00.000Z', 'in_progress', [1]),
  route('r3', 'v2', '2026-11-07T05:00:00.000Z', 'planned', [3]),
];

describe('vehicleStats', () => {
  it('groups routes per vehicle, newest first', () => {
    const grouped = groupRoutesByVehicle(routes);
    expect(grouped.get('v1')?.map((item) => item.id)).toEqual(['r2', 'r1']);
    expect(grouped.get('v2')?.map((item) => item.id)).toEqual(['r3']);
  });

  it('summarizes routes, stops, orders and the latest planned day', () => {
    expect(summarizeVehicleRoutes(groupRoutesByVehicle(routes).get('v1') ?? [])).toEqual({
      routes: 2, completedRoutes: 1, stops: 3, orders: 4, lastRouteDay: '2026-11-06',
    });
    expect(summarizeVehicleRoutes([])).toEqual({ routes: 0, completedRoutes: 0, stops: 0, orders: 0, lastRouteDay: null });
  });

  it('counts routes in each of the last six months, including empty ones and the year change', () => {
    const series = monthlyRoutes(routes.filter((item) => item.vehicleId === 'v1'), '2026-11-09');
    expect(series.map((item) => item.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(series.map((item) => item.routes)).toEqual([0, 0, 0, 1, 0, 1]);
    expect(monthlyRoutes([], '2027-02-01', 3).map((item) => item.month)).toEqual(['2026-12', '2027-01', '2027-02']);
  });

  it('picks an illustration from the free-text vehicle type', () => {
    expect(vehicleKind({ type: 'Moto lineal' })).toBe('moto');
    expect(vehicleKind({ type: 'Furgoneta' })).toBe('van');
    expect(vehicleKind({ type: 'Camión ligero' })).toBe('truck');
    expect(vehicleKind({ type: 'tico' })).toBe('car');
  });

  it('uses the Lima calendar day', () => {
    expect(todayInLima(new Date('2026-11-10T03:00:00.000Z'))).toBe('2026-11-09');
  });
});
