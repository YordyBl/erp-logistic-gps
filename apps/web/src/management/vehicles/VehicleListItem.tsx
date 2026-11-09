import { Check, CirclePause, MapPin, Package, Route } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useId } from 'react';

import type { Vehicle } from '../../api/client.js';
import { Badge } from '../../components/ui/badge.js';
import { Card } from '../../components/ui/card.js';
import { cn } from '../../lib/utils.js';
import { VEHICLE_IMAGES, vehicleKind, type VehicleStats } from './vehicleStats.js';

const NUMBER = new Intl.NumberFormat('es-PE');

/** Tarjeta de la flota: toda la tarjeta selecciona el vehículo para ver su detalle. */
export function VehicleListItem({ vehicle, stats, selected, onSelect }: {
  readonly vehicle: Vehicle;
  readonly stats: VehicleStats;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const active = vehicle.status === 'active';
  const labelId = useId();
  return (
    <li aria-labelledby={labelId}>
      <Card className={cn('relative gap-4 py-4 transition-colors', selected ? 'bg-primary/5 ring-2 ring-primary' : 'hover:bg-muted/50')}>
        <div className="flex items-center gap-3 px-4">
          <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg bg-muted">
            <img src={VEHICLE_IMAGES[vehicleKind(vehicle)]} alt="" width={64} height={36} className="h-9 w-16 object-contain" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <Badge variant={active ? 'success' : 'secondary'}>
              {active ? 'Activo' : 'Inactivo'}
              {active ? <Check data-icon="inline-end" aria-hidden="true" /> : <CirclePause data-icon="inline-end" aria-hidden="true" />}
            </Badge>
            <button id={labelId} type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined}
              className="truncate text-left font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50">
              <span className="tabular-nums">{vehicle.plate}</span>
              <span className="text-muted-foreground"> · {vehicle.type}</span>
            </button>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 border-t px-4 pt-3 text-xs">
          <Stat icon={Route} label="Rutas" value={stats.routes} />
          <Stat icon={MapPin} label="Paradas" value={stats.stops} />
          <Stat icon={Package} label="Pedidos" value={stats.orders} />
        </dl>
      </Card>
    </li>
  );
}

function Stat({ icon: Icon, label, value }: { readonly icon: LucideIcon; readonly label: string; readonly value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="flex items-center gap-1 text-muted-foreground"><Icon className="size-3.5" aria-hidden="true" />{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{NUMBER.format(value)}</dd>
    </div>
  );
}
