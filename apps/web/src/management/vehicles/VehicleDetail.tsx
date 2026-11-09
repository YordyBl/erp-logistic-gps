import { CalendarClock, Check, CircleCheckBig, CirclePause, MapPin, Package, Pencil, Route } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { lazy, Suspense, type ReactNode } from 'react';

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
import { countOrders, VEHICLE_IMAGES, vehicleKind, type MonthlyRoutes, type VehicleStats } from './vehicleStats.js';

const VehicleRoutesChart = lazy(() => import('./VehicleRoutesChart.js'));

const NUMBER = new Intl.NumberFormat('es-PE');
const SINCE = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'America/Lima' });

/** Detalle del vehículo elegido: actividad por mes, ficha, totales e historial de rutas. */
export function VehicleDetail({ vehicle, stats, monthly, routes, drivers, routesError, onEdit }: {
  readonly vehicle: Vehicle;
  readonly stats: VehicleStats;
  readonly monthly: readonly MonthlyRoutes[];
  readonly routes: readonly DispatchRoute[];
  readonly drivers: ReadonlyMap<string, Driver>;
  readonly routesError: boolean;
  readonly onEdit: () => void;
}) {
  const active = vehicle.status === 'active';
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Rutas por mes</CardTitle>
            <CardDescription>Últimos 6 meses, por fecha planificada.</CardDescription>
          </CardHeader>
          <CardContent>
            {routesError
              ? <p className="text-sm text-muted-foreground">Sin datos de rutas por ahora.</p>
              : (
                <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                  <VehicleRoutesChart data={monthly} />
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

      <dl className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile icon={CircleCheckBig} label="Completadas" value={routesError ? '—' : `${NUMBER.format(stats.completedRoutes)} de ${NUMBER.format(stats.routes)}`} />
        <StatTile icon={MapPin} label="Paradas" value={routesError ? '—' : NUMBER.format(stats.stops)} />
        <StatTile icon={Package} label="Pedidos" value={routesError ? '—' : NUMBER.format(stats.orders)} />
        <StatTile icon={CalendarClock} label="Última ruta" value={routesError ? '—' : stats.lastRouteDay === null ? 'Sin rutas' : formatPlannedDate(stats.lastRouteDay)} />
      </dl>

      <Card>
        <CardHeader>
          <CardTitle>Historial de rutas</CardTitle>
          <CardDescription>Rutas asignadas a {vehicle.plate}, de la más reciente a la más antigua.</CardDescription>
        </CardHeader>
        <CardContent>
          <RouteHistory routes={routes} drivers={drivers} routesError={routesError} />
        </CardContent>
      </Card>
    </div>
  );
}

function RouteHistory({ routes, drivers, routesError }: {
  readonly routes: readonly DispatchRoute[];
  readonly drivers: ReadonlyMap<string, Driver>;
  readonly routesError: boolean;
}) {
  if (routesError) return <ErrorNotice>No se pudo cargar el historial de rutas. Actualiza la página para reintentar.</ErrorNotice>;
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

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function StatTile({ icon: Icon, label, value }: { readonly icon: LucideIcon; readonly label: string; readonly value: string }) {
  return (
    <Card className="gap-3 py-4">
      <dt className="flex items-center gap-2 px-4 text-sm font-medium"><Icon className="size-4 text-muted-foreground" aria-hidden="true" />{label}</dt>
      <dd className="px-4 text-2xl font-semibold tabular-nums">{value}</dd>
    </Card>
  );
}
