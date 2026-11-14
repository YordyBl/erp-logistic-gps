import {
  Antenna, ClipboardList, Inbox, MapPinOff, PackagePlus, PartyPopper, RadioTower, RefreshCw, Route,
  Satellite, ShieldCheck, TriangleAlert, Truck, UserRound, type LucideIcon,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { ApiClient, DeliveryOrder, DeliveryOrderStatus, DispatchDashboardSummary } from '../api/client.js';
import { ActivityTimeline, type TimelineEvent } from '../components/ActivityTimeline.js';
import { AnnouncementBanner } from '../components/AnnouncementBanner.js';
import { ConfettiArt, SpheresArt } from '../components/CardArt.js';
import { IconChip, type IconChipTone } from '../components/IconChip.js';
import { ErrorNotice } from '../components/Notices.js';
import { ORDER_STATUS_ICONS } from '../components/OrderStatusBadge.js';
import { PageHeader } from '../components/PageHeader.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.js';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { Progress } from '../components/ui/progress.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js';
import { incidentCategoryLabel } from '../delivery/incidentCategories.js';
import { incidentIcon } from '../delivery/incidentIcons.js';
import { formatPlannedDate } from '../lib/dates.js';
import { formatDateTime, formatTime, formatTimeAgo, formatToday } from '../lib/format.js';
import { ORDER_STATUS_LABELS } from '../delivery/orderStatus.js';
import { deliveredShare, openOrders, STATUS_BADGES, totalOrders } from './dashboard/orderStatus.js';
import { OrderStatusBar } from './dashboard/OrderStatusBar.js';
import { loadRouteDetails, NO_ROUTE_DETAILS, type RouteDetails, type RouteDetailsClient } from './routes/routeDetails.js';
import { RouteStepper, RouteTimeline } from './routes/RouteTimeline.js';
import { summarizeRoute, type RouteProgress } from './routes/routeProgress.js';
import type { MapRoute } from './dashboard/OperationsMap.js';

const OperationsMap = lazy(() => import('./dashboard/OperationsMap.js')
  .then((module) => ({ default: module.OperationsMap })));

/** A partir de este tiempo sin posición, la ruta se señala para que alguien la revise. */
const STALE_SIGNAL_MINUTES = 15;

type DashboardClient = Pick<ApiClient, 'getDispatchDashboardSummary'> & RouteDetailsClient;
type ActiveRoute = DispatchDashboardSummary['activeRoutes'][number];

interface DashboardProps {
  readonly client: DashboardClient;
  readonly userName?: string;
  readonly onOpenOrders: () => void;
  readonly onOpenDispatch: () => void;
  readonly onOpenControlTower: () => void;
}

export function DispatchDashboardPage({ client, userName, onOpenOrders, onOpenDispatch, onOpenControlTower }: DashboardProps) {
  const [summary, setSummary] = useState<DispatchDashboardSummary | null>(null);
  const [details, setDetails] = useState<RouteDetails>(NO_ROUTE_DETAILS);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    void loadRouteDetails(client).then(setDetails);
    try {
      setSummary(await client.getDispatchDashboardSummary());
      setUpdatedAt(new Date().toISOString());
    } catch {
      setError('No se pudo cargar el resumen operativo. Comprueba la conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="flex flex-col gap-6" aria-labelledby="dispatch-dashboard-title">
      <PageHeader title="Estado del reparto" titleId="dispatch-dashboard-title"
        description={(
          <span className="block first-letter:uppercase">
            {formatToday()}{updatedAt !== null && ` · Actualizado a las ${formatTime(updatedAt)}`}
          </span>
        )}>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw data-icon="inline-start" aria-hidden="true" /> Actualizar
        </Button>
        <Button onClick={onOpenControlTower}>
          <RadioTower data-icon="inline-start" aria-hidden="true" /> Abrir torre de control
        </Button>
      </PageHeader>

      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {summary === null
        ? loading && <DashboardSkeleton />
        : <DashboardContent summary={summary} details={details} userName={userName} onOpenOrders={onOpenOrders} onOpenDispatch={onOpenDispatch} />}
    </section>
  );
}

function DashboardContent({ summary, details, userName, onOpenOrders, onOpenDispatch }: {
  readonly summary: DispatchDashboardSummary;
  readonly details: RouteDetails;
  readonly userName: string | undefined;
  readonly onOpenOrders: () => void;
  readonly onOpenDispatch: () => void;
}) {
  const counts = summary.orderStatusCounts;
  const total = totalOrders(counts);
  const orderById = useMemo(() => new Map(details.orders.map((order) => [order.id, order])), [details.orders]);
  const activity = useMemo(() => buildActivity(summary, orderById), [orderById, summary]);

  return (
    <>
      {summary.ordersAwaitingPlanning > 0 && (
        <AnnouncementBanner storageKey="banner-por-planificar" icon={Antenna}
          action={<Button type="button" variant="ghost" onClick={onOpenDispatch}>Planificar</Button>}>
          {summary.ordersAwaitingPlanning === 1 ? 'Tienes 1 pedido por planificar' : `Tienes ${summary.ordersAwaitingPlanning.toLocaleString('es-PE')} pedidos por planificar`}: agrúpalos en una ruta para despacharlos.
        </AnnouncementBanner>
      )}

      <ul className="grid grid-cols-2 gap-4 xl:grid-cols-12" aria-label="Indicadores del reparto">
        <DeliveriesCard deliveries={summary.deliveriesToday} userName={userName} />
        <DeliveredRingCard counts={counts} total={total} />
        <KpiCard icon={Truck} tone="primary" label="Rutas en curso" value={summary.routesInProgress} detail="Rutas iniciadas" />
        <KpiCard icon={summary.incidentsToday > 0 ? TriangleAlert : ShieldCheck} tone={summary.incidentsToday > 0 ? 'destructive' : 'success'}
          label="Incidencias de hoy" value={summary.incidentsToday} detail={summary.incidentsToday > 0 ? 'Registradas hoy' : 'Sin reportes hoy'} />
      </ul>

      <div className="grid gap-4 xl:grid-cols-3">
        <RouteTracking summary={summary} details={details} orderById={orderById} onOpenDispatch={onOpenDispatch} />

        <Card className="relative isolate overflow-hidden xl:col-span-2">
          <SpheresArt />
          <PanelHeader title="Actividad reciente" description="Últimos pedidos e incidencias registrados." />
          <CardContent>
            {activity.length === 0
              ? <PanelEmpty icon={ClipboardList}>La actividad de la operación aparecerá aquí.</PanelEmpty>
              : <ActivityTimeline events={activity} label="Actividad reciente" />}
          </CardContent>
        </Card>

        <Card>
          <PanelHeader title="Pedidos por estado"
            description={total === 0 ? undefined : `${deliveredShare(counts)} % entregados · ${openOrders(counts).toLocaleString('es-PE')} sin cerrar de ${total.toLocaleString('es-PE')}`}
            action={<Button variant="outline" onClick={onOpenOrders}>Ver pedidos</Button>} />
          <CardContent className="flex flex-1 flex-col justify-center">
            {total === 0 ? <PanelEmpty icon={Inbox}>Todavía no hay pedidos registrados.</PanelEmpty> : <OrderStatusBar counts={counts} />}
          </CardContent>
        </Card>

        <section className="mt-2 flex flex-col gap-3 xl:col-span-3" aria-labelledby="recent-orders-title">
          <div className="flex items-center justify-between gap-2">
            <h2 id="recent-orders-title" className="text-lg font-semibold">Pedidos recientes</h2>
            <Button variant="outline" onClick={onOpenOrders}>Ver todos</Button>
          </div>
          {summary.recentOrders.length === 0 ? <PanelEmpty icon={ClipboardList}>Los pedidos nuevos aparecerán aquí.</PanelEmpty> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead className="hidden md:table-cell">Destino</TableHead>
                  <TableHead className="hidden md:table-cell">Franja</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Creado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.recentOrders.map((order) => {
                  const detail = orderById.get(order.id);
                  return (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">{order.publicCode}</TableCell>
                      <TableCell className="hidden md:table-cell">{detail?.deliveryAddress.district ?? '—'}</TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{detail?.timeWindow ?? '—'}</TableCell>
                      <TableCell><StatusLabelBadge status={order.status} /></TableCell>
                      <TableCell className="hidden text-right text-muted-foreground sm:table-cell">{formatDateTime(order.createdAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </section>

      </div>
    </>
  );
}

function StatusLabelBadge({ status }: { readonly status: DeliveryOrderStatus }) {
  const Icon = ORDER_STATUS_ICONS[status];
  return <Badge variant={STATUS_BADGES[status]}>{ORDER_STATUS_LABELS[status]}<Icon data-icon="inline-end" aria-hidden="true" /></Badge>;
}

function DeliveriesCard({ deliveries, userName }: { readonly deliveries: number; readonly userName: string | undefined }) {
  const hasDeliveries = deliveries > 0;
  return (
    <li className="col-span-2 sm:col-span-1 xl:col-span-3">
      <Card size="sm" className="relative h-full overflow-hidden">
        {hasDeliveries && <ConfettiArt />}
        <CardContent className="relative flex h-full flex-col justify-center gap-1">
          <div className="flex flex-col gap-0.5">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              {hasDeliveries ? `¡Felicidades${userName === undefined ? '' : `, ${userName}`}!` : 'Aún sin entregas'}
              {hasDeliveries && <PartyPopper className="size-5 text-primary" aria-hidden="true" />}
            </h2>
            <p className="text-xs text-muted-foreground">Entregas de hoy</p>
          </div>
          <div className="flex items-baseline gap-2">
            <strong className="text-3xl font-semibold tabular-nums">{deliveries.toLocaleString('es-PE')}</strong>
            <p className="text-xs text-muted-foreground">Confirmadas hoy, hora de Lima</p>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

function DeliveredRingCard({ counts, total }: { readonly counts: DispatchDashboardSummary['orderStatusCounts']; readonly total: number }) {
  const share = deliveredShare(counts);
  return (
    <li className="col-span-2 sm:col-span-1 xl:col-span-3">
      <Card size="sm" className="h-full">
        <CardContent className="flex h-full flex-col gap-2">
          <p className="text-sm text-muted-foreground">Avance de entregas</p>
          <div className="grid flex-1 grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3">
            <svg viewBox="0 0 88 52" className="h-auto w-full" role="img" aria-label={`${share} % de los pedidos entregados`}>
              <path d="M10 44 A34 34 0 0 1 78 44" fill="none" stroke="var(--muted)" strokeWidth="8" strokeLinecap="round" />
              {share > 0 && (
                <path d="M10 44 A34 34 0 0 1 78 44" fill="none" stroke="var(--status-delivered)" strokeWidth="8" strokeLinecap="round"
                  pathLength={100} strokeDasharray={`${share} 100`} />
              )}
              <text x="44" y="40" textAnchor="middle" dominantBaseline="central" className="fill-foreground text-base font-semibold">{share}%</text>
            </svg>
            <p className="text-xs text-muted-foreground">
              {total === 0 ? 'Aún no hay pedidos registrados.' : (
                <>Llevas <span className="font-medium text-foreground">{share} %</span> de los pedidos entregados; {openOrders(counts).toLocaleString('es-PE')} siguen sin cerrar.</>
              )}
            </p>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}

function KpiCard({ icon, tone, label, value, detail }: {
  readonly icon: LucideIcon;
  readonly tone: IconChipTone;
  readonly label: string;
  readonly value: number;
  readonly detail: string;
}) {
  return (
    <li className="xl:col-span-3">
      <Card className="h-full">
        <CardContent className="flex h-full flex-row items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            <strong className="text-2xl font-semibold tabular-nums">{value.toLocaleString('es-PE')}</strong>
            <p className="text-xs text-muted-foreground">{detail}</p>
          </div>
          <IconChip icon={icon} tone={tone} />
        </CardContent>
      </Card>
    </li>
  );
}

/** Pedidos e incidencias recientes en un solo orden cronológico. */
function buildActivity(summary: DispatchDashboardSummary, orderById: ReadonlyMap<string, DeliveryOrder>): readonly TimelineEvent[] {
  const incidents = summary.recentIncidents.map((incident): TimelineEvent => ({
    id: `incident-${incident.id}`, occurredAt: incident.occurredAt, title: `Incidencia · ${incidentCategoryLabel(incident.category)}`,
    code: incident.publicCode, icon: incidentIcon(incident.category), tone: 'destructive',
  }));
  const orders = summary.recentOrders.map((order): TimelineEvent => {
    const district = orderById.get(order.id)?.deliveryAddress.district;
    return {
      id: `order-${order.id}`, occurredAt: order.createdAt, code: order.publicCode, icon: PackagePlus, tone: 'primary',
      title: district === undefined ? 'Pedido registrado' : `Pedido registrado para ${district}`,
    };
  });
  return [...incidents, ...orders].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 5);
}

function RouteTracking({ summary, details, orderById, onOpenDispatch }: {
  readonly summary: DispatchDashboardSummary;
  readonly details: RouteDetails;
  readonly orderById: ReadonlyMap<string, DeliveryOrder>;
  readonly onOpenDispatch: () => void;
}) {
  const [mapFailed, setMapFailed] = useState(false);
  const rows = useMemo(() => summary.activeRoutes.map((route) => {
    const dispatch = details.routes.find((item) => item.id === route.id);
    const progress = dispatch === undefined ? null : summarizeRoute(dispatch, orderById);
    return {
      route, dispatch, progress,
      driver: details.drivers.find((driver) => driver.id === dispatch?.driverId)?.fullName ?? null,
      plate: details.vehicles.find((vehicle) => vehicle.id === dispatch?.vehicleId)?.plate ?? null,
    };
  }), [details, orderById, summary.activeRoutes]);

  const mapRoutes = useMemo<readonly MapRoute[]>(() => rows.map(({ route, dispatch, progress }) => ({
    id: route.id,
    position: route.lastPosition,
    stops: (dispatch?.stops ?? []).flatMap((stop, index) => stop.latitude === null || stop.longitude === null ? [] : [{
      latitude: stop.latitude, longitude: stop.longitude, sequence: stop.sequence,
      state: progress?.stopStates[index] ?? 'pending',
    }]),
  })), [rows]);
  const showMap = !mapFailed && mapRoutes.some((route) => route.position !== null || route.stops.length > 0);

  if (rows.length === 0) {
    return (
      <Card className="xl:col-span-3">
        <PanelHeader title="Seguimiento de rutas" />
        <CardContent className="flex flex-1 flex-col justify-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><Route aria-hidden="true" /></EmptyMedia>
              <EmptyTitle>No hay rutas en curso ahora</EmptyTitle>
              <EmptyDescription>
                {summary.ordersAwaitingPlanning > 0
                  ? `Hay ${summary.ordersAwaitingPlanning.toLocaleString('es-PE')} ${summary.ordersAwaitingPlanning === 1 ? 'pedido listo' : 'pedidos listos'} para asignar a una ruta.`
                  : 'Cuando un conductor inicie su ruta, verás aquí su avance y su última posición.'}
              </EmptyDescription>
            </EmptyHeader>
            {summary.ordersAwaitingPlanning > 0 && <EmptyContent><Button onClick={onOpenDispatch}>Planificar una ruta</Button></EmptyContent>}
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0 xl:col-span-3">
      <div className="grid min-h-full md:grid-cols-2">
        <div className="flex flex-col gap-4 p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">Seguimiento de rutas</h2>
            <Badge variant="outline">{rows.length} {rows.length === 1 ? 'activa' : 'activas'}</Badge>
          </div>
          <ul className="flex flex-col divide-y">
            {rows.map(({ route, progress, driver, plate }) => (
              <RouteRow key={route.id} route={route} progress={progress} driver={driver} plate={plate} showStepper={showMap} />
            ))}
          </ul>
          <p className="mt-auto text-xs text-muted-foreground">La última posición recibida no garantiza la ubicación actual. ETA no disponible.</p>
        </div>
        {showMap ? (
          <div className="relative min-h-72 border-t md:border-t-0 md:border-l">
            <Suspense fallback={<Skeleton className="size-full rounded-none" />}>
              <OperationsMap routes={mapRoutes} onUnavailable={() => setMapFailed(true)} />
              <MapLegend />
            </Suspense>
          </div>
        ) : (
          <div className="flex flex-col gap-4 border-t p-6 text-sm md:border-t-0 md:border-l">
            <h3 className="font-medium">Paradas</h3>
            {rows.map(({ route, dispatch, progress }) => dispatch !== undefined && (
              <RouteTimeline key={route.id} stops={dispatch.stops.map((stop, index) => ({
                id: stop.id,
                addressLine: stop.addressLine,
                state: progress?.stopStates[index] ?? 'pending',
                detail: stop.orderIds.map((id) => {
                  const order = orderById.get(id);
                  return order === undefined ? 'Pedido' : `${order.publicCode} · ${ORDER_STATUS_LABELS[order.status]}`;
                }).join(', '),
              }))} />
            ))}
            <p className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPinOff className="size-3.5 shrink-0" aria-hidden="true" />
              {mapFailed ? 'No se pudo cargar el mapa.' : 'El mapa aparecerá cuando las paradas tengan coordenadas o llegue una posición.'}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

function RouteRow({ route, progress, driver, plate, showStepper }: {
  readonly route: ActiveRoute;
  readonly progress: RouteProgress | null;
  readonly driver: string | null;
  readonly plate: string | null;
  readonly showStepper: boolean;
}) {
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <strong className="text-sm font-medium tabular-nums">{route.publicCode}</strong>
          <span className="text-xs text-muted-foreground">Planificada para {formatPlannedDate(route.plannedDate)}</span>
        </div>
        <SignalBadge position={route.lastPosition} />
      </div>
      {(driver !== null || plate !== null) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {driver !== null && <span className="flex items-center gap-1.5"><UserRound className="size-4 text-muted-foreground" aria-hidden="true" />{driver}</span>}
          {plate !== null && <span className="flex items-center gap-1.5 tabular-nums"><Truck className="size-4 text-muted-foreground" aria-hidden="true" />{plate}</span>}
        </div>
      )}
      {progress !== null && progress.stopStates.length > 0 && (
        <div className="flex flex-col gap-2">
          {showStepper && <RouteStepper states={progress.stopStates} label={`Paradas de ${route.publicCode}`} />}
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{progress.closed} de {progress.total} {progress.total === 1 ? 'pedido cerrado' : 'pedidos cerrados'}{progress.returned > 0 && ` · ${progress.returned} ${progress.returned === 1 ? 'devuelto' : 'devueltos'}`}</span>
            <span className="tabular-nums">{progress.percent} %</span>
          </div>
          <Progress value={progress.percent} aria-label={`Avance de ${route.publicCode}`} />
          <dl className="mt-2 grid grid-cols-3 gap-2">
            <RouteFigure label="Paradas" value={progress.stopStates.length} />
            <RouteFigure label="Entregados" value={progress.delivered} />
            <RouteFigure label="Devueltos" value={progress.returned} />
          </dl>
        </div>
      )}
    </li>
  );
}

function RouteFigure({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="flex flex-col rounded-lg bg-muted p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value.toLocaleString('es-PE')}</dd>
    </div>
  );
}

function SignalBadge({ position }: { readonly position: ActiveRoute['lastPosition'] }) {
  if (position === null) return <Badge variant="secondary"><MapPinOff data-icon="inline-start" aria-hidden="true" />Sin señal aún</Badge>;
  const stale = Date.now() - new Date(position.receivedAt).getTime() > STALE_SIGNAL_MINUTES * 60_000;
  return (
    <Badge variant={stale ? 'warning' : 'success'} title={formatDateTime(position.receivedAt)}>
      <Satellite data-icon="inline-start" aria-hidden="true" />Última señal {formatTimeAgo(position.receivedAt)}
    </Badge>
  );
}

function MapLegend() {
  return (
    <ul className="absolute top-3 left-3 flex flex-col gap-1 rounded-lg border bg-background p-2 text-xs" aria-label="Leyenda del mapa">
      <li className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-primary" aria-hidden="true" />Parada completada</li>
      <li className="flex items-center gap-2"><span className="size-2.5 rounded-full bg-[#ef8b36]" aria-hidden="true" />Parada pendiente</li>
      <li className="flex items-center gap-2"><img src="/motorcycle-marker.svg" alt="" className="size-3.5" />Última señal</li>
    </ul>
  );
}

function PanelHeader({ title, description, action }: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly action?: ReactNode;
}) {
  return (
    <CardHeader>
      <CardTitle><h2>{title}</h2></CardTitle>
      {description !== undefined && <CardDescription>{description}</CardDescription>}
      {action !== undefined && <CardAction>{action}</CardAction>}
    </CardHeader>
  );
}

function PanelEmpty({ icon: Icon, children }: { readonly icon: LucideIcon; readonly children: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icon aria-hidden="true" /></EmptyMedia>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Cargando resumen operativo">
      <Skeleton className="h-24" />
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-96 xl:col-span-2" />
        <Skeleton className="h-96" />
      </div>
    </div>
  );
}
