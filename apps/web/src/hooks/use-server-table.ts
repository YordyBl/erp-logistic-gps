import type { ColumnFiltersState, OnChangeFn, PaginationState, SortingState, Updater } from '@tanstack/react-table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Page, PageParams } from '../api/client.js';
import { useDebouncedValue } from './use-debounced-value.js';

/** Conteos por faceta y valor, como los envía el servidor en `meta.counts`. */
export type FacetCounts = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** Estado controlado de la tabla: lo que `DataTable` recibe en `server.state`. */
export interface ServerTableState {
  readonly pagination: PaginationState;
  readonly sorting: SortingState;
  readonly globalFilter: string;
  readonly columnFilters: ColumnFiltersState;
}

/** Manejadores de TanStack para el estado anterior: lo que `DataTable` recibe en `server.handlers`. */
export interface ServerTableHandlers {
  readonly onPaginationChange: OnChangeFn<PaginationState>;
  readonly onSortingChange: OnChangeFn<SortingState>;
  readonly onGlobalFilterChange: OnChangeFn<string>;
  readonly onColumnFiltersChange: OnChangeFn<ColumnFiltersState>;
}

/** Lo que `DataTable` necesita para paginar, ordenar y filtrar en el servidor (su prop `server`). */
export interface DataTableServer {
  readonly state: ServerTableState;
  readonly handlers: ServerTableHandlers;
  /** Total de filas que cumplen la búsqueda y los filtros (`meta.total`). */
  readonly rowCount: number;
  /** Conteos por `columnId` del filtro y valor, para los números de `FacetedFilter`. */
  readonly facetCounts?: FacetCounts;
  /** Hay una petición en curso o una búsqueda esperando el debounce: el buscador muestra `busy`. */
  readonly loading?: boolean;
}

export interface ServerTableOptions {
  /** Filas por página al empezar. Por defecto 10, como `DataTable`. */
  readonly pageSize?: number;
  /** Orden inicial; vacío deja el orden por defecto del servidor. */
  readonly initialSorting?: SortingState;
  /** `columnId` → campo de `sort` en el servidor. Sin entrada se envía el propio `columnId`. */
  readonly sortFields?: Readonly<Record<string, string>>;
  /** `columnId` → parámetro de filtro (`status`, `timeWindow`...). Sin entrada se usa el propio `columnId`. */
  readonly filterParams?: Readonly<Record<string, string>>;
  /** Parámetros fijos que se añaden a cada petición; si cambian, se vuelve a la primera página. */
  readonly params?: PageParams;
  /** Espera tras la última tecla antes de buscar. Por defecto 300 ms. */
  readonly debounceMs?: number;
}

export interface ServerTable<T> {
  /** Filas de la página actual; se conservan las anteriores mientras llega la siguiente. */
  readonly rows: readonly T[];
  readonly meta: Page<T>['meta'] | null;
  readonly loading: boolean;
  readonly error: Error | null;
  /** Vuelve a pedir la página actual, por ejemplo tras crear, editar o cancelar. */
  readonly reload: () => void;
  readonly state: ServerTableState;
  readonly handlers: ServerTableHandlers;
  /** Parámetros de la última petición, con la búsqueda ya filtrada por el debounce. */
  readonly params: PageParams;
  /** Listo para pasar a `<DataTable server={...} />`. */
  readonly server: DataTableServer;
}

function resolve<Value>(updater: Updater<Value>, previous: Value): Value {
  return typeof updater === 'function' ? (updater as (old: Value) => Value)(previous) : updater;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Estado de una tabla paginada en el servidor. Traduce el estado de TanStack a `PageParams`
 * (`page`, `pageSize`, `q`, `sort=campo:dir` y un parámetro por filtro con valores separados por
 * comas), espera 300 ms tras la última tecla, vuelve a la página 1 cuando cambian la búsqueda, los
 * filtros, el orden o el tamaño de página, y cancela la petición anterior para que una respuesta
 * vieja nunca pise a la nueva.
 *
 * `fetchPage` no necesita ser estable: se usa siempre la última versión recibida.
 */
export function useServerTable<T>(
  fetchPage: (params: PageParams, signal: AbortSignal) => Promise<Page<T>>,
  options: ServerTableOptions = {},
): ServerTable<T> {
  const { debounceMs = 300 } = options;
  // Las opciones suelen escribirse en línea: se comparan por contenido (optionsKey) para no recalcular
  // en cada render.
  const optionsKey = JSON.stringify([options.sortFields ?? null, options.filterParams ?? null, options.params ?? null]);
  const { sortFields, filterParams, extraParams } = useMemo(
    () => ({ sortFields: options.sortFields, filterParams: options.filterParams, extraParams: options.params }),
    [optionsKey],
  );
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: options.pageSize ?? 10 });
  const [sorting, setSorting] = useState<SortingState>(options.initialSorting ?? []);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [result, setResult] = useState<Page<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const latestRequest = useRef(0);

  const q = useDebouncedValue(globalFilter.trim(), debounceMs);
  const sort = useMemo(() => {
    const first = sorting[0];
    if (first === undefined) return undefined;
    return `${sortFields?.[first.id] ?? first.id}:${first.desc ? 'desc' : 'asc'}`;
  }, [sortFields, sorting]);
  const filterValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const filter of columnFilters) {
      const value = Array.isArray(filter.value) ? filter.value.join(',') : String(filter.value ?? '');
      if (value !== '') values[filterParams?.[filter.id] ?? filter.id] = value;
    }
    return values;
  }, [columnFilters, filterParams]);

  // Cualquier cambio que no sea de página vuelve a la primera, ajustado durante el render para no
  // pedir antes la página vieja con los criterios nuevos.
  const criteriaKey = JSON.stringify([q, sort, filterValues, pagination.pageSize, extraParams ?? null]);
  const [lastCriteriaKey, setLastCriteriaKey] = useState(criteriaKey);
  if (lastCriteriaKey !== criteriaKey) {
    setLastCriteriaKey(criteriaKey);
    if (pagination.pageIndex !== 0) setPagination({ ...pagination, pageIndex: 0 });
  }

  const params = useMemo<PageParams>(() => ({
    ...extraParams,
    ...filterValues,
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    ...(q === '' ? {} : { q }),
    ...(sort === undefined ? {} : { sort }),
  }), [extraParams, filterValues, pagination.pageIndex, pagination.pageSize, q, sort]);
  const paramsKey = JSON.stringify(params);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++latestRequest.current;
    const requested = paramsRef.current;
    setLoading(true);
    fetchRef.current(requested, controller.signal).then((page) => {
      if (controller.signal.aborted || requestId !== latestRequest.current) return;
      setResult(page);
      setError(null);
      setLoading(false);
      // Si la página quedó vacía (por ejemplo, tras cancelar sus últimos registros), salta a la última.
      const lastIndex = Math.max(Math.ceil(page.meta.total / page.meta.pageSize) - 1, 0);
      if (page.data.length === 0 && (requested.page ?? 1) - 1 > lastIndex) {
        setPagination((current) => ({ ...current, pageIndex: lastIndex }));
      }
    }, (reason: unknown) => {
      if (controller.signal.aborted || requestId !== latestRequest.current) return;
      setError(toError(reason));
      setLoading(false);
    });
    return () => controller.abort();
  }, [paramsKey, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  const handlers = useMemo<ServerTableHandlers>(() => ({
    onPaginationChange: (updater) => setPagination((current) => resolve(updater, current)),
    onSortingChange: (updater) => setSorting((current) => resolve(updater, current)),
    onGlobalFilterChange: (updater) => setGlobalFilter((current) => String(resolve(updater, current) ?? '')),
    onColumnFiltersChange: (updater) => setColumnFilters((current) => resolve(updater, current)),
  }), []);
  const state = useMemo<ServerTableState>(
    () => ({ pagination, sorting, globalFilter, columnFilters }),
    [columnFilters, globalFilter, pagination, sorting],
  );

  const meta = result?.meta ?? null;
  const facetCounts = useMemo(() => {
    const counts = meta?.counts;
    if (counts === undefined) return undefined;
    const byColumn: Record<string, Readonly<Record<string, number>>> = { ...counts };
    for (const [columnId, param] of Object.entries(filterParams ?? {})) {
      const facet = counts[param];
      if (facet !== undefined) byColumn[columnId] = facet;
    }
    return byColumn;
  }, [filterParams, meta]);
  const rowCount = meta?.total ?? 0;
  // Mientras corre el debounce la búsqueda ya está en curso para quien escribe.
  const busy = loading || globalFilter.trim() !== q;
  const server = useMemo<DataTableServer>(
    () => ({ state, handlers, rowCount, loading: busy, ...(facetCounts === undefined ? {} : { facetCounts }) }),
    [busy, facetCounts, handlers, rowCount, state],
  );
  const rows = useMemo(() => result?.data ?? [], [result]);

  return { rows, meta, loading, error, reload, state, handlers, params, server };
}
