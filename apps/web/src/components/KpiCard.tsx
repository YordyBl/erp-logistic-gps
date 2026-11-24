import { TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';

import { IconChip, type IconChipTone } from './IconChip.js';
import { Card, CardContent } from './ui/card.js';

/** Variación frente al periodo anterior; `better` y `worse` dicen si conviene, no si sube. */
export interface KpiChange {
  readonly text: string;
  readonly direction: 'up' | 'down' | 'flat';
  readonly tone: 'better' | 'worse' | 'neutral';
}

const CHANGE_TONES: Record<KpiChange['tone'], string> = {
  better: 'text-success-foreground',
  worse: 'text-destructive',
  neutral: 'text-muted-foreground',
};

/**
 * Tarjeta de cifra del Resumen y de Reportes, dentro de una lista (`<ul>`). `className` solo coloca
 * la tarjeta en la rejilla.
 */
export function KpiCard({ icon, tone, label, value, detail, change, className = 'xl:col-span-3' }: {
  readonly icon: LucideIcon;
  readonly tone: IconChipTone;
  readonly label: string;
  readonly value: number | string;
  readonly detail: string;
  readonly change?: KpiChange;
  readonly className?: string;
}) {
  const ChangeIcon = change?.direction === 'up' ? TrendingUp : change?.direction === 'down' ? TrendingDown : undefined;
  return (
    <li className={className}>
      <Card className="h-full">
        <CardContent className="flex h-full flex-row items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            <strong className="text-2xl font-semibold tabular-nums">{typeof value === 'number' ? value.toLocaleString('es-PE') : value}</strong>
            {change !== undefined && (
              <p className={`flex items-center gap-1 text-xs font-medium ${CHANGE_TONES[change.tone]}`}>
                {ChangeIcon !== undefined && <ChangeIcon className="size-3.5" aria-hidden="true" />}
                <span>{change.text}</span>
              </p>
            )}
            <p className="text-xs text-muted-foreground">{detail}</p>
          </div>
          <IconChip icon={icon} tone={tone} />
        </CardContent>
      </Card>
    </li>
  );
}
