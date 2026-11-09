import { Check, TriangleAlert } from 'lucide-react';

import type { StopState } from './routeProgress.js';

const MARKER_CLASSES: Record<StopState, string> = {
  done: 'bg-primary text-primary-foreground',
  issue: 'bg-destructive text-primary-foreground',
  current: 'border-2 border-primary bg-background text-primary',
  pending: 'border border-input bg-background text-muted-foreground',
};

const STATE_LABELS: Record<StopState, string> = {
  done: 'completada',
  issue: 'con incidencia',
  current: 'en curso',
  pending: 'pendiente',
};

export function StopMarker({ state, sequence }: { readonly state: StopState; readonly sequence: number }) {
  return (
    <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums ${MARKER_CLASSES[state]}`}>
      {state === 'done' && <Check className="size-3.5" aria-hidden="true" />}
      {state === 'issue' && <TriangleAlert className="size-3.5" aria-hidden="true" />}
      {(state === 'current' || state === 'pending') && <span aria-hidden="true">{sequence}</span>}
    </span>
  );
}

/** Paradas en vertical: línea continua en lo ya recorrido, punteada en lo que falta. */
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
              <span className={`min-h-4 flex-1 border-l-2 ${stop.state === 'done' || stop.state === 'issue' ? 'border-primary' : 'border-dashed border-input'}`} aria-hidden="true" />
            )}
          </div>
          <div className="flex min-w-0 flex-col pb-4">
            <span className="font-medium">{stop.addressLine}<span className="sr-only"> · parada {STATE_LABELS[stop.state]}</span></span>
            <span className="text-muted-foreground">{stop.detail}</span>
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
            <span className={`h-0 flex-1 border-t-2 ${state === 'done' || state === 'issue' ? 'border-primary' : 'border-dashed border-input'}`} aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}
