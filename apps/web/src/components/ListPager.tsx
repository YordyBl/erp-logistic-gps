import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { ServerTable } from '../hooks/use-server-table.js';
import { Button } from './ui/button.js';

const NUMBER = new Intl.NumberFormat('es-PE');

/**
 * Rango visible y anterior / siguiente para una lista paginada en el servidor que no es una tabla
 * (tarjetas, listas con detalle). Se ve siempre que haya filas, también con una sola página, para que
 * quede claro cuántas hay; solo se oculta cuando la lista está vacía.
 */
export function ListPager({ table, label }: {
  readonly table: Pick<ServerTable<unknown>, 'meta' | 'state' | 'handlers' | 'loading'>;
  /** Qué se pagina, para los nombres accesibles: "vehículos", "conductores"... */
  readonly label: string;
}) {
  const total = table.meta?.total ?? 0;
  if (total === 0) return null;

  const { pageIndex, pageSize } = table.state.pagination;
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);
  const first = Math.min(pageIndex * pageSize + 1, total);
  const last = Math.min((pageIndex + 1) * pageSize, total);
  const goTo = (index: number) => table.handlers.onPaginationChange((current) => ({ ...current, pageIndex: index }));
  return (
    <nav aria-label={`Páginas de ${label}`} className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground tabular-nums">Mostrando {NUMBER.format(first)}–{NUMBER.format(last)} de {NUMBER.format(total)}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs tabular-nums">Página {pageIndex + 1} de {pageCount}</span>
        <Button type="button" variant="outline" size="icon" aria-label={`Página anterior de ${label}`}
          disabled={pageIndex === 0 || table.loading} onClick={() => goTo(pageIndex - 1)}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button type="button" variant="outline" size="icon" aria-label={`Página siguiente de ${label}`}
          disabled={pageIndex >= pageCount - 1 || table.loading} onClick={() => goTo(pageIndex + 1)}>
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
