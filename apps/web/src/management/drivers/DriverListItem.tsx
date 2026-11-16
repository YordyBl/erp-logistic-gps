import { Check, CirclePause, MapPin, Package, Route } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useId } from 'react';

import type { Driver } from '../../api/client.js';
import { Avatar, AvatarFallback } from '../../components/ui/avatar.js';
import { Badge } from '../../components/ui/badge.js';
import { Card } from '../../components/ui/card.js';
import { initials } from '../../lib/format.js';
import { cn } from '../../lib/utils.js';

const NUMBER = new Intl.NumberFormat('es-PE');

/** Viajes, paradas y pedidos del conductor en el periodo; `null` cuando no se pudieron cargar. */
export interface DriverTotals {
  readonly routes: number;
  readonly stops: number;
  readonly orders: number;
}

/** Tarjeta de la lista de conductores: toda la tarjeta selecciona al conductor para ver su detalle. */
export function DriverListItem({ driver, totals, selected, onSelect }: {
  readonly driver: Driver;
  readonly totals: DriverTotals | null;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const active = driver.status === 'active';
  const labelId = useId();
  return (
    <li aria-labelledby={labelId}>
      <Card className={cn('relative gap-4 py-4 transition-colors', selected ? 'bg-primary/5 ring-2 ring-primary' : 'hover:bg-muted/50')}>
        <div className="flex items-center gap-3 px-4">
          <Avatar size="lg">
            <AvatarFallback className={active ? 'bg-primary/10 font-semibold text-primary' : 'font-semibold'}>{initials(driver.fullName)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <Badge variant={active ? 'success' : 'secondary'}>
              {active ? 'Activo' : 'Inactivo'}
              {active ? <Check data-icon="inline-end" aria-hidden="true" /> : <CirclePause data-icon="inline-end" aria-hidden="true" />}
            </Badge>
            <button id={labelId} type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined}
              className="truncate text-left font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50">
              {driver.fullName}
            </button>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 border-t px-4 pt-3 text-xs">
          <Stat icon={Route} label="Viajes" value={totals?.routes} />
          <Stat icon={MapPin} label="Paradas" value={totals?.stops} />
          <Stat icon={Package} label="Pedidos" value={totals?.orders} />
        </dl>
      </Card>
    </li>
  );
}

function Stat({ icon: Icon, label, value }: { readonly icon: LucideIcon; readonly label: string; readonly value: number | undefined }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="flex items-center gap-1 text-muted-foreground"><Icon className="size-3.5" aria-hidden="true" />{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value === undefined ? '—' : NUMBER.format(value)}</dd>
    </div>
  );
}
