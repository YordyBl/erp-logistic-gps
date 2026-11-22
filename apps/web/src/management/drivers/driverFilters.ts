import type { Driver, DriverAccountOption } from '../../api/client.js';

export type DriverFilter = 'all' | 'active' | 'inactive' | 'unlinked';

export const DRIVER_FILTERS: readonly { readonly value: DriverFilter; readonly label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
  { value: 'unlinked', label: 'Sin cuenta' },
];

export type AccountsByDriver = ReadonlyMap<string, DriverAccountOption>;

/** Cuenta vinculada de cada conductor, por su ID. */
export function indexAccountsByDriver(accounts: readonly DriverAccountOption[]): AccountsByDriver {
  return new Map(accounts.flatMap((account) => account.driverId === null ? [] : [[account.driverId, account] as const]));
}

export function matchesFilter(driver: Driver, filter: DriverFilter, accounts: AccountsByDriver): boolean {
  switch (filter) {
    case 'all': return true;
    case 'active': return driver.status === 'active';
    case 'inactive': return driver.status === 'inactive';
    case 'unlinked': return !accounts.has(driver.id);
  }
}

export function countByFilter(drivers: readonly Driver[], accounts: AccountsByDriver): Readonly<Record<DriverFilter, number>> {
  const counts: Record<DriverFilter, number> = { all: 0, active: 0, inactive: 0, unlinked: 0 };
  for (const driver of drivers) {
    for (const { value } of DRIVER_FILTERS) if (matchesFilter(driver, value, accounts)) counts[value] += 1;
  }
  return counts;
}

/** Conductores del filtro cuyo nombre, documento, licencia o teléfono contienen la búsqueda. */
export function filterDrivers(drivers: readonly Driver[], filter: DriverFilter, query: string, accounts: AccountsByDriver): readonly Driver[] {
  const needle = normalize(query.trim());
  return drivers.filter((driver) => matchesFilter(driver, filter, accounts) &&
    (needle === '' || [driver.fullName, driver.documentNumber, driver.licenseNumber, driver.phone]
      .some((value) => normalize(value).includes(needle))));
}

/** Minúsculas y sin tildes, para que "Gomez" encuentre "Gómez". */
function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es-PE');
}
