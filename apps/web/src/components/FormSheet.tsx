import type { FormEvent, ReactNode } from 'react';

import { useFocusReturn } from '../hooks/use-focus-return.js';
import { resolveOpener } from '../lib/focusOpener.js';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from './ui/sheet.js';

const WIDTHS = {
  default: 'doc-form gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg',
  wide: 'doc-form gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl',
} as const;

/** Cabecera común de los paneles laterales. */
function PanelHeader({ title, description }: { readonly title: string; readonly description: string }) {
  return (
    <SheetHeader className="border-b pr-12">
      <SheetTitle>{title}</SheetTitle>
      <SheetDescription>{description}</SheetDescription>
    </SheetHeader>
  );
}

/**
 * Formulario de registro o edición en un panel lateral. El estado vive en quien lo usa, así que
 * cerrar el panel por accidente no borra lo escrito. Con `paper`, el contenido se muestra como una
 * hoja sobre fondo gris, igual que un documento.
 */
export function FormSheet({ open, onOpenChange, title, description, formLabel, width = 'default', paper = false, onSubmit, footer, children }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly formLabel?: string;
  readonly width?: keyof typeof WIDTHS;
  readonly paper?: boolean;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly footer: ReactNode;
  readonly children: ReactNode;
}) {
  const focus = useFocusReturn();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={WIDTHS[width]}
        onOpenAutoFocus={() => focus.remember(resolveOpener())}
        onCloseAutoFocus={focus.onCloseAutoFocus}>
        <PanelHeader title={title} description={description} />
        <form className="flex min-h-0 flex-1 flex-col" aria-label={formLabel} onSubmit={onSubmit}>
          {paper
            ? <DocumentBody>{children}</DocumentBody>
            : <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">{children}</div>}
          <SheetFooter className="mt-0 border-t sm:flex-row sm:justify-end">{footer}</SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Panel de solo lectura con aspecto de documento, para ver el detalle de un registro. */
export function DocumentSheet({ open, onOpenChange, title, description, footer, children }: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description: string;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}) {
  const focus = useFocusReturn();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={WIDTHS.wide}
        onOpenAutoFocus={() => focus.remember(resolveOpener())}
        onCloseAutoFocus={focus.onCloseAutoFocus}>
        <PanelHeader title={title} description={description} />
        <DocumentBody>{children}</DocumentBody>
        {footer !== undefined && <SheetFooter className="mt-0 border-t sm:flex-row sm:justify-end">{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  );
}

function DocumentBody({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto bg-muted p-3 sm:p-6">
      <div className="flex min-h-full flex-col gap-8 border bg-card p-5 shadow-sm sm:p-8">{children}</div>
    </div>
  );
}

/** Título grande del documento, con sus datos de cabecera a la izquierda. */
export function DocumentTitle({ title, children, aside }: { readonly title: string; readonly children?: ReactNode; readonly aside?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-xl font-medium tracking-tight">{title}</h3>
        {children !== undefined && <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">{children}</div>}
      </div>
      {aside}
    </div>
  );
}

/** Fila del resumen de un documento; `strong` la destaca como total. */
export function DocumentTotal({ label, value, strong = false }: { readonly label: string; readonly value: string; readonly strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? 'mt-2 border-t pt-3' : 'py-1'}`}>
      <span className="text-[0.6875rem] text-muted-foreground">{label}</span>
      <span className={strong ? 'text-xl font-medium tabular-nums' : 'text-[0.6875rem] text-muted-foreground tabular-nums'}>{value}</span>
    </div>
  );
}
