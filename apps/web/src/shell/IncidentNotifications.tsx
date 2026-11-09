import { Bell, ShieldCheck, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { ApiClient, DispatchDashboardSummary } from '../api/client.js';
import { IconChip } from '../components/IconChip.js';
import { ErrorNotice } from '../components/Notices.js';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { Separator } from '../components/ui/separator.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { incidentCategoryLabel } from '../delivery/incidentCategories.js';
import { incidentIcon } from '../delivery/incidentIcons.js';
import { countLabel, formatTimeAgo } from '../lib/format.js';

type NotificationsClient = Pick<ApiClient, 'getDispatchDashboardSummary'>;

/** Campana de la barra superior: incidencias recientes y pedidos devueltos, con el número de las de hoy. */
export function IncidentNotifications({ client, refreshKey, onOpenOrder, onOpenDispatch }: {
  readonly client: NotificationsClient;
  /** Al cambiar, por ejemplo al navegar, vuelve a consultar. */
  readonly refreshKey: string;
  readonly onOpenOrder: (publicCode: string) => void;
  readonly onOpenDispatch: () => void;
}) {
  const [summary, setSummary] = useState<DispatchDashboardSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setSummary(await client.getDispatchDashboardSummary());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [client]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) void load();
  }

  const todayCount = summary?.incidentsToday ?? 0;
  const returned = summary?.orderStatusCounts.returned ?? 0;
  const label = summary === null
    ? 'Notificaciones'
    : `Notificaciones: ${countLabel(todayCount, 'incidencia', 'incidencias')} hoy`;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="relative" aria-label={label}>
          <Bell aria-hidden="true" />
          {todayCount > 0 && (
            <span className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[0.625rem] font-semibold text-white tabular-nums" aria-hidden="true">
              {todayCount > 9 ? '9+' : todayCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] gap-0 p-0">
        <div className="flex flex-col gap-0.5 p-4">
          <h2 className="text-sm font-medium">Notificaciones</h2>
          <p className="text-xs text-muted-foreground">
            {summary === null ? 'Incidencias de la operación.' : `${countLabel(todayCount, 'incidencia registrada', 'incidencias registradas')} hoy.`}
          </p>
        </div>
        <Separator />
        <div className="flex max-h-96 flex-col gap-1 overflow-y-auto p-2">
          {failed && (
            <ErrorNotice action={<Button type="button" variant="outline" className="mt-2" onClick={() => void load()}>Reintentar</Button>}>
              No se pudieron cargar las notificaciones.
            </ErrorNotice>
          )}
          {!failed && summary === null && <Skeleton className="h-16 w-full" />}
          {!failed && summary !== null && summary.recentIncidents.length === 0 && returned === 0 && (
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <IconChip icon={ShieldCheck} tone="success" />
              <p className="text-sm font-medium">Sin incidencias registradas</p>
              <p className="text-xs text-muted-foreground">Aquí aparecerán los problemas que reporten los conductores.</p>
            </div>
          )}
          {summary !== null && returned > 0 && (
            <Button type="button" variant="ghost" className="h-auto justify-start gap-3 p-2 text-left whitespace-normal"
              onClick={() => { setOpen(false); onOpenDispatch(); }}>
              <IconChip icon={Undo2} tone="warning" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{countLabel(returned, 'pedido devuelto', 'pedidos devueltos')} por reprogramar</span>
                <span className="text-xs font-normal text-muted-foreground">Abrir despacho</span>
              </span>
            </Button>
          )}
          {summary?.recentIncidents.map((incident) => (
            <Button key={incident.id} type="button" variant="ghost" className="h-auto items-start justify-start gap-3 p-2 text-left whitespace-normal"
              onClick={() => { setOpen(false); onOpenOrder(incident.publicCode); }}>
              <IconChip icon={incidentIcon(incident.category)} tone="destructive" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{incidentCategoryLabel(incident.category)}</span>
                <span className="text-xs font-normal text-muted-foreground">{incident.description}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  <span className="font-medium text-foreground tabular-nums">{incident.publicCode}</span> · {formatTimeAgo(incident.occurredAt)}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
