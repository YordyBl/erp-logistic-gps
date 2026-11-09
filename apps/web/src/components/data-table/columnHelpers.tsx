import type { Column } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown, EllipsisVertical } from 'lucide-react';
import type { ReactNode } from 'react';

import { rememberOpener } from '../../lib/focusOpener.js';
import { Button } from '../ui/button.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuTrigger } from '../ui/dropdown-menu.js';
import { Progress } from '../ui/progress.js';

/** Cabecera que ordena al pulsarla: ascendente, descendente y sin orden. */
export function SortableHeader<TData, TValue>({ column, title }: { readonly column: Column<TData, TValue>; readonly title: string }) {
  const direction = column.getIsSorted();
  const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ChevronsUpDown;
  return (
    <Button type="button" variant="ghost" className="-ml-2.5" onClick={column.getToggleSortingHandler()}>
      {title} <Icon data-icon="inline-end" aria-hidden="true" />
    </Button>
  );
}

/** Menú de tres puntos con las acciones de una fila. */
export function RowActions({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex justify-end">
      {/* Sin modal: las acciones abren paneles y dos capas modales a la vez bloquean la página. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label={label} onPointerDown={(event) => rememberOpener(event.currentTarget)}
            onKeyDown={(event) => rememberOpener(event.currentTarget)}><EllipsisVertical aria-hidden="true" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>{children}</DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Barra de avance para una celda; el color va de coral a verde según lo completado. */
export function TableProgress({ percent, detail, label }: { readonly percent: number; readonly detail: string; readonly label: string }) {
  const color = percent >= 67 ? 'var(--status-delivered)' : percent >= 34 ? 'var(--status-in-transit)' : 'var(--status-returned)';
  return (
    <div className="flex min-w-32 flex-col gap-1">
      <div className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>{detail}</span>
        <span className="tabular-nums">{percent} %</span>
      </div>
      <Progress value={percent} aria-label={label} className="[&_[data-slot=progress-indicator]]:bg-(--bar)" style={{ '--bar': color } as React.CSSProperties} />
    </div>
  );
}
