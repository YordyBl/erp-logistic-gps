import type { ColumnFiltersState } from '@tanstack/react-table';

import type { DriverAccountOption } from '../../api/client.js';
import type { FacetCounts } from '../../hooks/use-server-table.js';

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

/** El chip elegido como filtro del servidor: `status` para el estado y `account` para "Sin cuenta". */
export function toColumnFilters(filter: DriverFilter): ColumnFiltersState {
  switch (filter) {
    case 'all': return [];
    case 'active':
    case 'inactive': return [{ id: 'status', value: filter }];
    case 'unlinked': return [{ id: 'account', value: 'unlinked' }];
  }
}

/** El chip que corresponde a los filtros actuales de la tabla. */
export function filterFromColumns(filters: ColumnFiltersState): DriverFilter {
  const status = filters.find((item) => item.id === 'status')?.value;
  if (status === 'active' || status === 'inactive') return status;
  return filters.some((item) => item.id === 'account' && item.value === 'unlinked') ? 'unlinked' : 'all';
}

/** Conteo de cada chip según las facetas del servidor, que ignoran el chip elegido. */
export function chipCounts(counts: FacetCounts | undefined): Readonly<Record<DriverFilter, number>> {
  const active = counts?.status?.active ?? 0;
  const inactive = counts?.status?.inactive ?? 0;
  return { all: active + inactive, active, inactive, unlinked: counts?.account?.unlinked ?? 0 };
}
