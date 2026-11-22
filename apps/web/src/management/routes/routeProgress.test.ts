import { describe, expect, it } from 'vitest';

import { summarizeRoute } from './routeProgress.js';

const stop = (id: string, orderIds: readonly string[]) => ({
  id, sequence: 1, addressLine: id, latitude: null, longitude: null, orderIds,
});
const orders = new Map([
  ['delivered', { status: 'delivered' as const }],
  ['returned', { status: 'returned' as const }],
  ['transit', { status: 'in_transit' as const }],
  ['assigned', { status: 'assigned' as const }],
]);

describe('summarizeRoute', () => {
  it('counts final orders and marks only the first open stop as current', () => {
    const progress = summarizeRoute({
      status: 'in_progress',
      stops: [stop('a', ['delivered']), stop('b', ['returned']), stop('c', ['transit']), stop('d', ['assigned'])],
    }, orders);

    expect(progress).toEqual({
      total: 4, delivered: 1, returned: 1, closed: 2, percent: 50,
      stopStates: ['done', 'issue', 'current', 'pending'],
    });
  });

  it('never marks a current stop before the route starts', () => {
    const progress = summarizeRoute({ status: 'planned', stops: [stop('a', ['assigned'])] }, orders);

    expect(progress.stopStates).toEqual(['pending']);
    expect(progress.percent).toBe(0);
  });

  it('does not invent progress when the orders are unknown', () => {
    const progress = summarizeRoute({ status: 'in_progress', stops: [stop('a', ['missing'])] }, orders);

    expect(progress.total).toBe(0);
    expect(progress.percent).toBe(0);
  });
});
