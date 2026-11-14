import { Check, X } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import type { StopState } from './routeProgress.js';

/** Hecha: sólida en verde. Incidencia: sólida en rojo. En curso: aro azul. Pendiente: aro gris punteado. */
const MARKER_CLASSES: Record<StopState, string> = {
  done: 'bg-green-700/90 text-white',
  issue: 'bg-destructive/90 text-white',
  current: 'border-2 border-blue-700/90 bg-background text-blue-700 dark:text-blue-400',
  pending: 'border border-dashed border-muted-foreground/50 bg-background text-muted-foreground',
};

const STATE_LABELS: Record<StopState, string> = {
  done: 'completada',
  issue: 'con incidencia',
  current: 'en curso',
  pending: 'pendiente',
};

const STATE_BADGES: Record<StopState, { readonly label: string; readonly variant: 'success' | 'destructive' | 'info' | 'secondary' }> = {
  done: { label: 'Completada', variant: 'success' },
  issue: { label: 'Incidencia', variant: 'destructive' },
  current: { label: 'En curso', variant: 'info' },
  pending: { label: 'Pendiente', variant: 'secondary' },
};

const LINE_CLASSES: Record<StopState, string> = {
  done: 'border-green-700/70',
  issue: 'border-destructive/70',
  current: 'border-muted-foreground/40',
  pending: 'border-muted-foreground/40',
};

export function StopMarker({ state, sequence }: { readonly state: StopState; readonly sequence: number }) {
  return (
    <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${MARKER_CLASSES[state]}`}>
      {state === 'done' && <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />}
      {state === 'issue' && <X className="size-3.5" strokeWidth={3} aria-hidden="true" />}
      {(state === 'current' || state === 'pending') && <span aria-hidden="true">{sequence}</span>}
    </span>
  );
}

/** Paradas en vertical con una línea punteada que une los marcadores; solo la dirección y el pedido llevan texto. */
export function RouteTimeline({ stops }: {
  readonly stops: readonly {
    readonly id: string;
    readonly addressLine: string;
    readonly detail: string;
    readonly state: StopState;
  }[];
}) {
  return (
    <ol className="flex flex-col">
      {stops.map((stop, index) => (
        <li key={stop.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <StopMarker state={stop.state} sequence={index + 1} />
            {index < stops.length - 1 && (
              <span className={`my-1 min-h-4 flex-1 border-l-2 border-dashed ${LINE_CLASSES[stop.state]}`} aria-hidden="true" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col pt-0.5 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-xs font-medium ${stop.state === 'pending' ? 'text-muted-foreground' : ''}`}>{stop.addressLine}</span>
              <Badge variant={STATE_BADGES[stop.state].variant} className="px-1.5 py-0 text-[10px]">{STATE_BADGES[stop.state].label}</Badge>
            </div>
            {stop.detail !== '' && <span className="text-[11px] text-muted-foreground">{stop.detail}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Las mismas paradas en horizontal, para las filas de seguimiento. */
export function RouteStepper({ states, label }: { readonly states: readonly StopState[]; readonly label: string }) {
  return (
    <ol className="flex items-center" aria-label={label}>
      {states.map((state, index) => (
        <li key={index} className={`flex items-center ${index < states.length - 1 ? 'flex-1' : ''}`}>
          <StopMarker state={state} sequence={index + 1} />
          <span className="sr-only">Parada {index + 1}: {STATE_LABELS[state]}</span>
          {index < states.length - 1 && (
            <span className={`h-0 flex-1 border-t-2 border-dashed ${LINE_CLASSES[state]}`} aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}
