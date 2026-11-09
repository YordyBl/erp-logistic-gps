import type { LucideIcon } from 'lucide-react';

import { formatDateOnly, formatTime } from '../lib/format.js';
import { IconChip, type IconChipTone } from './IconChip.js';

export interface TimelineEvent {
  readonly id: string;
  readonly occurredAt: string;
  readonly title: string;
  readonly description?: string;
  readonly code?: string;
  readonly icon: LucideIcon;
  readonly tone?: IconChipTone;
}

/** Eventos en orden, con la fecha en una columna fija y cada icono centrado sobre la línea que los une. */
export function ActivityTimeline({ events, label }: { readonly events: readonly TimelineEvent[]; readonly label: string }) {
  return (
    <ol className="flex flex-col" aria-label={label}>
      {events.map((event, index) => (
        <li key={event.id} className="grid grid-cols-[5.75rem_auto_minmax(0,1fr)] gap-x-3">
          <time className="flex flex-col pt-1 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums" dateTime={event.occurredAt}>
            <span className="font-medium text-foreground">{formatDateOnly(event.occurredAt)}</span>
            <span>{formatTime(event.occurredAt)}</span>
          </time>
          <div className="flex flex-col items-center">
            <IconChip icon={event.icon} {...(event.tone === undefined ? {} : { tone: event.tone })} />
            {index < events.length - 1 && <span className="min-h-4 flex-1 border-l border-dashed border-input" aria-hidden="true" />}
          </div>
          <div className={`flex min-w-0 flex-col gap-0.5 pt-1 ${index < events.length - 1 ? 'pb-5' : ''}`}>
            <strong className="text-sm font-medium">{event.title}</strong>
            {event.description !== undefined && <p className="text-sm text-muted-foreground">{event.description}</p>}
            {event.code !== undefined && <span className="text-xs font-medium tabular-nums">{event.code}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
