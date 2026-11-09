import {
  flexRender, getCoreRowModel, getFacetedRowModel, getFacetedUniqueValues, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable, type ColumnDef, type ColumnFiltersState, type Row, type RowData, type SortingState,
  type Table as TanstackTable, type VisibilityState,
} from '@tanstack/react-table';
import { Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleSlash, PlusCircle, Settings2, X, type LucideIcon } from 'lucide-react';
import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';

import { rememberOpener } from '../../lib/focusOpener.js';
import { SearchInput } from '../SearchInput.js';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '../ui/command.js';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuTrigger } from '../ui/dropdown-menu.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '../ui/empty.js';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Separator } from '../ui/separator.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table.js';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- la firma debe coincidir con la de la librería.
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Nombre para el menú de columnas. */
    readonly title?: string;
    /** Clases compartidas por la cabecera y las celdas, por ejemplo para ocultar en móvil. */
    readonly className?: string;
  }
}

const PAGE_SIZES = [5, 10, 20, 50] as const;

export interface DataTableFilter {
  readonly columnId: string;
  readonly title: string;
  readonly options: readonly { readonly value: string; readonly label: string; readonly icon?: LucideIcon }[];
}

/** Tabla con búsqueda, filtros, orden, columnas visibles y paginación en el cliente. */
export function DataTable<TData>({ label, columns, data, searchPlaceholder, filters = [], pageSize = 10, onRowClick, actions }: {
  readonly label: string;
  readonly columns: readonly ColumnDef<TData, unknown>[];
  /** Debe ser una referencia estable: cada cambio devuelve la tabla a la primera página. */
  readonly data: readonly TData[];
  readonly searchPlaceholder: string;
  readonly filters?: readonly DataTableFilter[];
  readonly pageSize?: number;
  readonly onRowClick?: (row: TData) => void;
  readonly actions?: ReactNode;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = useState('');
  const rows = useMemo(() => [...data], [data]);
  const columnDefs = useMemo(() => [...columns] as ColumnDef<TData>[], [columns]);

  const table = useReactTable<TData>({
    data: rows,
    columns: columnDefs,
    state: { sorting, columnFilters, columnVisibility, globalFilter },
    initialState: { pagination: { pageSize, pageIndex: 0 } },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: 'includesString',
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  const isFiltered = columnFilters.length > 0 || globalFilter !== '';
  const hideableColumns = table.getAllLeafColumns().filter((column) => column.getCanHide() && column.columnDef.meta?.title !== undefined);

  function clearFilters() {
    setColumnFilters([]);
    setGlobalFilter('');
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={globalFilter} onChange={setGlobalFilter} placeholder={searchPlaceholder} />
        {filters.map((filter) => <FacetedFilter key={filter.columnId} table={table} filter={filter} />)}
        {isFiltered && (
          <Button type="button" variant="ghost" onClick={clearFilters}>
            Limpiar <X data-icon="inline-end" aria-hidden="true" />
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {hideableColumns.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="max-sm:hidden"><Settings2 data-icon="inline-start" aria-hidden="true" /> Columnas</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Columnas visibles</DropdownMenuLabel>
                  {hideableColumns.map((column) => (
                    <DropdownMenuCheckboxItem key={column.id} checked={column.getIsVisible()} onCheckedChange={(checked) => column.toggleVisibility(checked)}>
                      {column.columnDef.meta?.title}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {actions}
        </div>
      </div>

      <Table aria-label={label}>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id} className={header.column.columnDef.meta?.className}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => <DataRow key={row.id} row={row} onRowClick={onRowClick} />)}
          {table.getRowModel().rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={table.getVisibleLeafColumns().length}>
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><CircleSlash aria-hidden="true" /></EmptyMedia>
                    <EmptyDescription>{isFiltered ? 'Ningún resultado coincide con la búsqueda o los filtros.' : 'Todavía no hay registros.'}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Pagination table={table} />
    </div>
  );
}

function DataRow<TData>({ row, onRowClick }: { readonly row: Row<TData>; readonly onRowClick: ((row: TData) => void) | undefined }) {
  function handleClick(event: MouseEvent<HTMLTableRowElement>) {
    // Los botones y menús de la fila hacen lo suyo; solo el resto de la fila abre el detalle.
    if (onRowClick === undefined || (event.target as Element).closest('button, a, [role="menu"]') !== null) return;
    rememberOpener(event.currentTarget.querySelector('button'));
    onRowClick(row.original);
  }

  return (
    <TableRow onClick={handleClick} className={onRowClick === undefined ? undefined : 'cursor-pointer'}>
      {row.getVisibleCells().map((cell) => (
        <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  );
}

function FacetedFilter<TData>({ table, filter }: { readonly table: TanstackTable<TData>; readonly filter: DataTableFilter }) {
  const column = table.getColumn(filter.columnId);
  const facets = column?.getFacetedUniqueValues();
  const selected = new Set((column?.getFilterValue() as string[] | undefined) ?? []);

  function toggle(value: string) {
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
    column?.setFilterValue(selected.size === 0 ? undefined : [...selected]);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="border-dashed">
          <PlusCircle data-icon="inline-start" aria-hidden="true" /> {filter.title}
          {selected.size > 0 && (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              <Badge variant="secondary">{selected.size}</Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Filtrar ${filter.title.toLowerCase()}`} />
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              {filter.options.map((option) => {
                const isSelected = selected.has(option.value);
                const Icon = option.icon;
                return (
                  <CommandItem key={option.value} value={option.label} onSelect={() => toggle(option.value)}>
                    <span className={`flex size-4 items-center justify-center rounded-[4px] border ${isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-input [&_svg]:invisible'}`}>
                      <Check className="size-3.5 text-current" aria-hidden="true" />
                    </span>
                    {Icon !== undefined && <Icon className="size-4 text-muted-foreground" aria-hidden="true" />}
                    <span>{option.label}</span>
                    <span data-slot="command-shortcut" className="ml-auto text-xs text-muted-foreground tabular-nums">{facets?.get(option.value) ?? 0}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selected.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem className="justify-center" onSelect={() => column?.setFilterValue(undefined)}>Limpiar filtro</CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Pagination<TData>({ table }: { readonly table: TanstackTable<TData> }) {
  const { pageIndex, pageSize } = table.getState().pagination;
  const total = table.getFilteredRowModel().rows.length;
  const pageCount = Math.max(table.getPageCount(), 1);

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <p className="text-xs text-muted-foreground tabular-nums">{total.toLocaleString('es-PE')} {total === 1 ? 'resultado' : 'resultados'}</p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Filas por página</span>
          <Select value={String(pageSize)} onValueChange={(value) => table.setPageSize(Number(value))}>
            <SelectTrigger className="w-20" aria-label="Filas por página"><SelectValue placeholder={String(pageSize)} /></SelectTrigger>
            <SelectContent side="top">
              <SelectGroup>
                {PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs tabular-nums">Página {pageIndex + 1} de {pageCount}</span>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="icon" className="max-lg:hidden" aria-label="Primera página" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}><ChevronsLeft aria-hidden="true" /></Button>
          <Button type="button" variant="outline" size="icon" aria-label="Página anterior" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}><ChevronLeft aria-hidden="true" /></Button>
          <Button type="button" variant="outline" size="icon" aria-label="Página siguiente" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}><ChevronRight aria-hidden="true" /></Button>
          <Button type="button" variant="outline" size="icon" className="max-lg:hidden" aria-label="Última página" onClick={() => table.setPageIndex(pageCount - 1)} disabled={!table.getCanNextPage()}><ChevronsRight aria-hidden="true" /></Button>
        </div>
      </div>
    </div>
  );
}
