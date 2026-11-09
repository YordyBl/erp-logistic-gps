import { describe, expect, it } from 'vitest';

import type { Driver, DriverAccountOption } from '../../api/client.js';
import { countByFilter, filterDrivers, indexAccountsByDriver } from './driverFilters.js';

const base: Driver = {
  id: 'driver-1', organizationId: 'org-1', fullName: 'Valeria Gómez', documentNumber: 'DNI-123456',
  phone: '900 000 101', licenseNumber: 'A-123456', status: 'active',
  createdAt: '2026-11-02T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z',
};
const drivers: readonly Driver[] = [
  base,
  { ...base, id: 'driver-2', fullName: 'Luis Peña', documentNumber: 'DNI-999999', phone: '900 000 102', status: 'inactive' },
];
const linked: DriverAccountOption = { userId: 'user-1', email: 'valeria@example.test', status: 'active', driverId: 'driver-1' };
const free: DriverAccountOption = { userId: 'user-2', email: 'libre@example.test', status: 'active', driverId: null };
const accounts = indexAccountsByDriver([linked, free]);

describe('driverFilters', () => {
  it('indexes only accounts linked to a driver', () => {
    expect([...accounts.keys()]).toEqual(['driver-1']);
  });

  it('counts drivers in every filter', () => {
    expect(countByFilter(drivers, accounts)).toEqual({ all: 2, active: 1, inactive: 1, unlinked: 1 });
  });

  it('combines the filter with a search that ignores accents and case', () => {
    expect(filterDrivers(drivers, 'all', 'GOMEZ', accounts).map((driver) => driver.id)).toEqual(['driver-1']);
    expect(filterDrivers(drivers, 'active', 'pena', accounts)).toEqual([]);
    expect(filterDrivers(drivers, 'unlinked', '', accounts).map((driver) => driver.id)).toEqual(['driver-2']);
    expect(filterDrivers(drivers, 'all', ' 000 102 ', accounts).map((driver) => driver.id)).toEqual(['driver-2']);
  });
});
