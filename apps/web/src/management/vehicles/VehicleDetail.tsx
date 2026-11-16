import { CalendarClock, Check, CircleCheckBig, CirclePause, MapPin, Package, Pencil, Route } from 'lucide-react';
import { lazy, Suspense } from 'react';

import type { DispatchRoute, Driver, Vehicle } from '../../api/client.js';
import { ErrorNotice } from '../../components/Notices.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.js';
import { ROUTE_BADGES, ROUTE_STATUS_LABELS } from '../../delivery/orderStatus.js';
import { formatPlannedDate } from '../../lib/dates.js';
import { Field, StatTile } from '../shared/DetailParts.js';
import { countOrders, VEHICLE_IMAGES, vehicleKind, type MonthlyRoutes, type VehicleStats } from './vehicleStats.js';

const RoutesChart = lazy(() => import('../shared/RoutesChart.js'));

const NUMBER = new Intl.NumberFormat('es-PE');
const SINCE = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'America/Lima' });

/**
 * Detalle del vehículo elegido: actividad por mes, ficha, totales e historial de rutas. Los totales y la
 * serie vienen agregados del servidor; el historial es solo la página más reciente de sus rutas.
 */
export function VehicleDetail({ vehicle, stats, monthly, routes, routesTotal, drivers, routesError, historyError, historyLoading = false, periodLabel = 'todo el historial', chartCaption = 'Últimos 12 meses', onEdit }: {
  readonly vehicle: Vehicle;
  readonly stats: VehicleStats;
  readonly monthly: readonly MonthlyRoutes[];
  /** Las rutas más recientes del vehículo (una página). */
  readonly routes: readonly DispatchRoute[];
  /** Total de rutas del vehículo en el servidor; si supera las mostradas se avisa. */
  readonly routesTotal: number;
  readonly drivers: ReadonlyMap<string, Driver>;
  /** No llegaron los totales ni la serie mensual. */
  readonly routesError: boolean;
  /** No llegó el historial de rutas. */
  readonly historyError: boolean;
  /** El historial del vehículo aún no llega. */
  readonly historyLoading?: boolean;
  /** Periodo de los totales, en minúsculas ("este mes"). La última ruta siempre es la más reciente. */
  readonly periodLabel?: string;
  /** Meses que cubre la serie mensual ("Este mes", "Últimos 12 meses"). */
  readonly chartCaption?: string;
  readonly onEdit: () => void;
}) {
  const active = vehicle.status === 'active';
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Rutas por mes</CardTitle>
            <CardDescription>{chartCaption}, por fecha planificada.</CardDescription>
          </CardHeader>
          <CardContent>
            {routesError
              ? <p className="text-sm text-muted-foreground">Sin datos de rutas por ahora.</p>
              : (
                <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                  <RoutesChart data={monthly} />
                </Suspense>
              )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ficha del vehículo</CardTitle>
            <CardAction>
              <Button type="button" variant="outline" onClick={onEdit} aria-label={`Editar vehículo ${vehicle.plate}`}>
                <Pencil data-icon="inline-start" aria-hidden="true" />Editar
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="grid flex-1 items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <dl className="flex flex-col gap-3 text-sm">
              <Field label="Placa"><span className="text-base font-semibold tabular-nums">{vehicle.plate}</span></Field>
              <Field label="Disponibilidad">
                <Badge variant={active ? 'success' : 'secondary'}>
                  {active ? 'Activo' : 'Inactivo'}
                  {active ? <Check data-icon="inline-end" aria-hidden="true" /> : <CirclePause data-icon="inline-end" aria-hidden="true" />}
                </Badge>
              </Field>
              <Field label="Tipo">{vehicle.type}</Field>
              <Field label="Capacidad">{vehicle.capacityKg === null ? 'No especificada' : `${NUMBER.format(vehicle.capacityKg)} kg`}</Field>
              <Field label="Registrado">{SINCE.format(new Date(vehicle.createdAt))}</Field>
            </dl>
            <div className="flex items-center justify-center rounded-xl bg-muted p-4">
              <img src={VEHICLE_IMAGES[vehicleKind(vehicle)]} alt={`Ilustración de ${vehicle.type}`} width={320} height={180} className="h-auto w-full max-w-72" />
            </div>
          </CardContent>
        </Card>
      </div>

      <section aria-label="Métricas del vehículo" className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">Métricas de {periodLabel}</p>
        <dl className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatTile icon={CircleCheckBig} label="Completadas" value={routesError ? '—' : `${NUMBER.format(stats.completedRoutes)} de ${NUMBER.format(stats.routes)}`} />
          <StatTile icon={MapPin} label="Paradas" value={routesError ? '—' : NUMBER.format(stats.stops)} />
          <StatTile icon={Package} label="Pedidos" value={routesError ? '—' : NUMBER.format(stats.orders)} />
          <StatTile icon={CalendarClock} label="Última ruta" value={routesError ? '—' : stats.lastRouteDay === null ? 'Sin rutas' : formatPlannedDate(stats.lastRouteDay)} />
        </dl>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Historial de rutas</CardTitle>
          <CardDescription>
            Rutas asignadas a {vehicle.plate}, de la más reciente a la más antigua.
            {!historyLoading && !historyError && routesTotal > routes.length && ` Mostrando las ${NUMBER.format(routes.length)} más recientes de ${NUMBER.format(routesTotal)}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading
            ? <Skeleton className="h-24 w-full" aria-label="Cargando historial de rutas" />
            : <RouteHistory routes={routes} drivers={drivers} historyError={historyError} />}
        </CardContent>
      </Card>
    </div>
  );
}

function RouteHistory({ routes, drivers, historyError }: {
  readonly routes: readonly DispatchRoute[];
  readonly drivers: ReadonlyMap<string, Driver>;
  readonly historyError: boolean;
}) {
  if (historyError) return <ErrorNotice>No se pudo cargar el historial de rutas. Actualiza la página para reintentar.</ErrorNotice>;
  if (routes.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Route aria-hidden="true" /></EmptyMedia>
          <EmptyTitle>Aún no tiene rutas</EmptyTitle>
          <EmptyDescription>Asigna este vehículo al planificar una ruta en Despacho y aparecerá aquí.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fecha</TableHead>
          <TableHead>Ruta</TableHead>
          <TableHead>Conductor</TableHead>
          <TableHead className="text-right">Paradas</TableHead>
          <TableHead className="text-right">Pedidos</TableHead>
          <TableHead>Estado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {routes.map((route) => (
          <TableRow key={route.id}>
            <TableCell className="tabular-nums">{formatPlannedDate(route.plannedDate)}</TableCell>
            <TableCell className="font-medium tabular-nums">{route.publicCode}</TableCell>
            <TableCell>{drivers.get(route.driverId)?.fullName ?? 'Conductor no disponible'}</TableCell>
            <TableCell className="text-right tabular-nums">{route.stops.length}</TableCell>
            <TableCell className="text-right tabular-nums">{countOrders(route)}</TableCell>
            <TableCell><Badge variant={ROUTE_BADGES[route.status]}>{ROUTE_STATUS_LABELS[route.status]}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
