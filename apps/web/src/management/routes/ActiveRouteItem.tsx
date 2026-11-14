import { ChevronDown, MapPinOff, Satellite, Truck, UserRound } from 'lucide-react';

import { TableProgress } from '../../components/data-table/columnHelpers.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible.js';
import { ORDER_STATUS_LABELS, ROUTE_BADGES, ROUTE_STATUS_LABELS } from '../../delivery/orderStatus.js';
import { formatPlannedDate } from '../../lib/dates.js';
import { countLabel, formatTimeAgo, formatTimeWithSeconds } from '../../lib/format.js';
import type { RouteDetails } from './routeDetails.js';
import { summarizeRoute } from './routeProgress.js';
import { RouteTimeline } from './RouteTimeline.js';

/** A partir de este tiempo sin posición, la señal se marca para que alguien la revise. */
const STALE_SIGNAL_MS = 15 * 60_000;

/** Una ruta de la Torre de control: quién la lleva, su señal, su avance y sus paradas. */
export function ActiveRouteItem({ route, position, details }: {
  readonly route: {
    readonly id: string;
    readonly publicCode: string;
    readonly plannedDate: string;
    readonly status: 'planned' | 'in_progress' | 'completed';
    readonly stops: readonly { readonly id: string; readonly addressLine: string }[];
  };
  readonly position: { readonly receivedAt: string } | undefined;
  readonly details: RouteDetails;
}) {
  const dispatch = details.routes.find((item) => item.id === route.id);
  const orderById = new Map(details.orders.map((order) => [order.id, order]));
  const progress = dispatch === undefined ? null : summarizeRoute(dispatch, orderById);
  const driver = details.drivers.find((item) => item.id === dispatch?.driverId)?.fullName;
  const plate = details.vehicles.find((item) => item.id === dispatch?.vehicleId)?.plate;

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-3">
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h3 className="text-sm font-medium tabular-nums">{route.publicCode}</h3>
          <span className="text-xs text-muted-foreground">{formatPlannedDate(route.plannedDate)}</span>
        </div>
        <Badge variant={ROUTE_BADGES[route.status]}>{ROUTE_STATUS_LABELS[route.status]}</Badge>
      </header>

      {(driver !== undefined || plate !== undefined) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {driver !== undefined && <span className="flex items-center gap-1.5"><UserRound className="size-4 text-muted-foreground" aria-hidden="true" />{driver}</span>}
          {plate !== undefined && <span className="flex items-center gap-1.5 tabular-nums"><Truck className="size-4 text-muted-foreground" aria-hidden="true" />{plate}</span>}
        </div>
      )}

      <SignalLine position={position} />

      {progress !== null && progress.total > 0 && (
        <TableProgress percent={progress.percent} label={`Avance de ${route.publicCode}`}
          detail={`${progress.closed} de ${countLabel(progress.total, 'pedido cerrado', 'pedidos cerrados')}${progress.returned > 0 ? ` · ${countLabel(progress.returned, 'devuelto', 'devueltos')}` : ''}`} />
      )}

      <Collapsible className="group/stops flex flex-col gap-3">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="link" className="h-auto justify-between p-0 text-foreground">
            {countLabel(route.stops.length, 'parada', 'paradas')}
            <ChevronDown data-icon="inline-end" className="transition-transform group-data-[state=open]/stops:rotate-180" aria-hidden="true" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="text-sm">
          <RouteTimeline stops={route.stops.map((stop, index) => {
            const orderIds = dispatch?.stops.find((item) => item.id === stop.id)?.orderIds ?? [];
            return {
              id: stop.id,
              addressLine: stop.addressLine,
              state: progress?.stopStates[index] ?? 'pending',
              detail: orderIds.flatMap((id) => {
                const order = orderById.get(id);
                return order === undefined ? [] : [`${order.publicCode} · ${ORDER_STATUS_LABELS[order.status]}`];
              }).join(', '),
            };
          })} />
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function SignalLine({ position }: { readonly position: { readonly receivedAt: string } | undefined }) {
  if (position === undefined) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPinOff className="size-3.5 shrink-0" aria-hidden="true" /> Aún no hay una posición recibida.
      </p>
    );
  }
  const stale = Date.now() - new Date(position.receivedAt).getTime() > STALE_SIGNAL_MS;
  return (
    <p className={`flex flex-wrap items-center gap-1.5 text-xs ${stale ? 'text-badge-warning-text' : 'text-badge-success-text'}`}>
      <Satellite className="size-3.5 shrink-0" aria-hidden="true" />
      <span>Última posición recibida · {formatTimeWithSeconds(position.receivedAt)}</span>
      <span className="text-muted-foreground">({formatTimeAgo(position.receivedAt)})</span>
    </p>
  );
}
