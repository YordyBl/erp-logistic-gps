import type { ReactNode } from 'react';

import { useFocusReturn } from '../hooks/use-focus-return.js';
import { resolveOpener } from '../lib/focusOpener.js';
import { formatDateOnly, formatTime } from '../lib/format.js';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from './ui/sheet.js';

/**
 * Detalle de un registro en un panel angosto: etiqueta, código y estado en la cabecera, datos clave-valor
 * y secciones en el cuerpo, y las acciones en el pie. Los registros y ediciones siguen en `FormSheet`.
 */
export function DetailSheet({ open, onOpenChange, eyebrow, title, status, description, footer, children }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Qué es el registro («Pedido», «Ruta»), sobre el código. */
  readonly eyebrow: string;
  /** El código del registro: es el título accesible del panel. */
  readonly title: string;
  /** Badge de estado bajo el título. */
  readonly status?: ReactNode;
  /** Resumen para lectores de pantalla. */
  readonly description: string;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}) {
  const focus = useFocusReturn();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        onOpenAutoFocus={() => focus.remember(resolveOpener())}
        onCloseAutoFocus={focus.onCloseAutoFocus}>
        <SheetHeader className="gap-1.5 border-b px-6 py-5 pr-14">
          <span className="text-xs text-muted-foreground">{eyebrow}</span>
          <SheetTitle className="font-mono text-xl font-semibold tabular-nums">{title}</SheetTitle>
          <SheetDescription className="sr-only">{description}</SheetDescription>
          {status !== undefined && <div className="flex">{status}</div>}
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">{children}</div>
        {footer !== undefined && <SheetFooter className="mt-0 flex-row gap-2 border-t px-6 py-4">{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  );
}

/** Datos del registro en dos columnas: etiqueta y valor. */
export function DetailFields({ children }: { readonly children: ReactNode }) {
  return <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">{children}</dl>;
}

export function DetailField({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** Bloque con título dentro del detalle. */
export function DetailSection({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export interface TrailEvent {
  readonly id: string;
  readonly occurredAt: string;
  readonly title: string;
  readonly detail?: string;
  /** Color del punto, uno fijo por estado. */
  readonly color: string;
}

/** Recorrido de estados: un punto de color por evento, unidos por una línea, con la hora a la derecha. */
export function StatusTrail({ events, label }: { readonly events: readonly TrailEvent[]; readonly label: string }) {
  return (
    <ol className="flex flex-col" aria-label={label}>
      {events.map((event, index) => (
        <li key={event.id} className="grid grid-cols-[0.75rem_minmax(0,1fr)_auto] gap-x-3">
          <span className="flex flex-col items-center" aria-hidden="true">
            <span className="mt-1 size-3 shrink-0 rounded-full" style={{ backgroundColor: event.color }} />
            {index < events.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
          </span>
          <span className={`flex min-w-0 flex-col ${index < events.length - 1 ? 'pb-3' : ''}`}>
            <span className="text-sm font-medium">{event.title}</span>
            {event.detail !== undefined && <span className="text-xs text-muted-foreground">{event.detail}</span>}
          </span>
          <time className="pt-0.5 text-right font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums" dateTime={event.occurredAt}>
            {formatDateOnly(event.occurredAt)} {formatTime(event.occurredAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}
