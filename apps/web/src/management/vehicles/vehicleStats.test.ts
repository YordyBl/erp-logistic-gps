import { describe, expect, it } from 'vitest';

import { countOrders, toMonthlyRoutes, toVehicleStats, vehicleKind } from './vehicleStats.js';

describe('vehicleStats', () => {
  it('maps the server totals to the fleet stats', () => {
    expect(toVehicleStats({
      vehicleId: 'v1', routes: 2, completed: 1, stops: 3, orders: 4, lastRouteDay: '2026-11-06', monthly: [],
    })).toEqual({ routes: 2, completedRoutes: 1, stops: 3, orders: 4, lastRouteDay: '2026-11-06' });
  });

  it('labels each month of the server series, across the year change', () => {
    const series = toMonthlyRoutes([
      { month: '2026-12', routes: 0 }, { month: '2027-01', routes: 2 }, { month: '2027-02', routes: 1 },
    ]);
    // The ICU data decides the capitalization of the short month name.
    expect(series.map((item) => ({ ...item, label: item.label.toLowerCase() }))).toEqual([
      { month: '2026-12', label: 'dic', routes: 0 },
      { month: '2027-01', label: 'ene', routes: 2 },
      { month: '2027-02', label: 'feb', routes: 1 },
    ]);
  });

  it('counts the orders of every stop of a route', () => {
    expect(countOrders({ stops: [
      { id: 's1', sequence: 1, addressLine: 'Av. Arequipa 100', latitude: null, longitude: null, orderIds: ['o1', 'o2'] },
      { id: 's2', sequence: 2, addressLine: 'Av. Brasil 200', latitude: null, longitude: null, orderIds: ['o3'] },
    ] })).toBe(3);
  });

  it('picks an illustration from the free-text vehicle type', () => {
    expect(vehicleKind({ type: 'Moto lineal' })).toBe('moto');
    expect(vehicleKind({ type: 'Furgoneta' })).toBe('van');
    expect(vehicleKind({ type: 'Camión ligero' })).toBe('truck');
    expect(vehicleKind({ type: 'tico' })).toBe('car');
  });
});
