import { describe, expect, it } from 'vitest';

import type { DriverAccountOption } from '../../api/client.js';
import { chipCounts, filterFromColumns, indexAccountsByDriver, toColumnFilters } from './driverFilters.js';

const linked: DriverAccountOption = { userId: 'user-1', email: 'valeria@example.test', status: 'active', driverId: 'driver-1' };
const free: DriverAccountOption = { userId: 'user-2', email: 'libre@example.test', status: 'active', driverId: null };

describe('driverFilters', () => {
  it('indexes only accounts linked to a driver', () => {
    expect([...indexAccountsByDriver([linked, free]).keys()]).toEqual(['driver-1']);
  });

  it('maps every chip to the server filter and back', () => {
    expect(toColumnFilters('all')).toEqual([]);
    expect(toColumnFilters('active')).toEqual([{ id: 'status', value: 'active' }]);
    expect(toColumnFilters('inactive')).toEqual([{ id: 'status', value: 'inactive' }]);
    expect(toColumnFilters('unlinked')).toEqual([{ id: 'account', value: 'unlinked' }]);
    for (const chip of ['all', 'active', 'inactive', 'unlinked'] as const) {
      expect(filterFromColumns(toColumnFilters(chip))).toBe(chip);
    }
  });

  it('reads the chip counts from the server facets, zero when absent', () => {
    expect(chipCounts({ status: { active: 3, inactive: 1 }, account: { linked: 1, unlinked: 3 } }))
      .toEqual({ all: 4, active: 3, inactive: 1, unlinked: 3 });
    expect(chipCounts(undefined)).toEqual({ all: 0, active: 0, inactive: 0, unlinked: 0 });
  });
});
