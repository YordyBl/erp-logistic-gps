import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { ServerTable } from '../hooks/use-server-table.js';
import { Button } from './ui/button.js';

/**
 * Anterior / siguiente para una lista paginada en el servidor que no es una tabla (tarjetas,
 * listas con detalle). Se oculta cuando todo cabe en una página.
 */
export function ListPager({ table, label }: {
  readonly table: Pick<ServerTable<unknown>, 'meta' | 'state' | 'handlers' | 'loading'>;
  /** Qué se pagina, para los nombres accesibles: "vehículos", "conductores"... */
  readonly label: string;
}) {
  const { pageIndex, pageSize } = table.state.pagination;
  const pageCount = Math.max(Math.ceil((table.meta?.total ?? 0) / pageSize), 1);
  if (pageCount <= 1) return null;

  const goTo = (index: number) => table.handlers.onPaginationChange((current) => ({ ...current, pageIndex: index }));
  return (
    <nav aria-label={`Páginas de ${label}`} className="flex items-center justify-end gap-3">
      <span className="text-xs tabular-nums">Página {pageIndex + 1} de {pageCount}</span>
      <Button type="button" variant="outline" size="icon" aria-label={`Página anterior de ${label}`}
        disabled={pageIndex === 0 || table.loading} onClick={() => goTo(pageIndex - 1)}>
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Button type="button" variant="outline" size="icon" aria-label={`Página siguiente de ${label}`}
        disabled={pageIndex >= pageCount - 1 || table.loading} onClick={() => goTo(pageIndex + 1)}>
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}
