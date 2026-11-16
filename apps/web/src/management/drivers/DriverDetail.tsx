import { CalendarClock, Check, CircleAlert, CircleCheckBig, CirclePause, KeyRound, MapPin, Package, Pencil, Route } from 'lucide-react';
import { lazy, Suspense } from 'react';

import type { DispatchRoute, Driver, DriverAccountOption, DriverRouteStats, Vehicle } from '../../api/client.js';
import { ErrorNotice } from '../../components/Notices.js';
import { Avatar, AvatarFallback } from '../../components/ui/avatar.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.js';
import { ROUTE_BADGES, ROUTE_STATUS_LABELS } from '../../delivery/orderStatus.js';
import { formatPlannedDate } from '../../lib/dates.js';
import { initials } from '../../lib/format.js';
import { Field, StatTile } from '../shared/DetailParts.js';
import { countOrders, type MonthlyRoutes } from '../vehicles/vehicleStats.js';

const RoutesChart = lazy(() => import('../shared/RoutesChart.js'));

const NUMBER = new Intl.NumberFormat('es-PE');
const SINCE = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'America/Lima' });

/**
 * Detalle del conductor elegido, como el de un vehículo: viajes por mes, ficha con su cuenta, totales e
 * historial de viajes. Los totales y la serie vienen agregados del servidor; el historial es solo la
 * página más reciente de sus rutas.
 */
export function DriverDetail({
  driver, stats, monthly, account, canBindAccounts, routes, routesTotal, vehicles, statsError, historyError,
  historyLoading, periodLabel, chartCaption, onEdit, onManageAccount,
}: {
  readonly driver: Driver;
  /** Totales del periodo; sin entrada el conductor no tuvo viajes. */
  readonly stats: Omit<DriverRouteStats, 'driverId' | 'monthly'> | undefined;
  readonly monthly: readonly MonthlyRoutes[];
  readonly account: DriverAccountOption | undefined;
  readonly canBindAccounts: boolean;
  /** Los viajes más recientes del conductor (una página). */
  readonly routes: readonly DispatchRoute[];
  readonly routesTotal: number;
  /** Placas por ID para el historial. */
  readonly vehicles: ReadonlyMap<string, Vehicle>;
  /** No llegaron los totales ni la serie mensual. */
  readonly statsError: boolean;
  readonly historyError: boolean;
  readonly historyLoading: boolean;
  /** Periodo de los totales, en minúsculas ("este mes"). El último viaje siempre es el más reciente. */
  readonly periodLabel: string;
  /** Meses que cubre la serie mensual ("Este mes", "Últimos 12 meses"). */
  readonly chartCaption: string;
  readonly onEdit: () => void;
  readonly onManageAccount: () => void;
}) {
  const active = driver.status === 'active';
  const totals = stats ?? { routes: 0, completed: 0, stops: 0, orders: 0, lastRouteDay: null };
  return (
    <section aria-label={`Detalle de ${driver.fullName}`} className="flex min-w-0 flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Viajes por mes</CardTitle>
            <CardDescription>{chartCaption}, por fecha planificada.</CardDescription>
          </CardHeader>
          <CardContent>
            {statsError
              ? <p className="text-sm text-muted-foreground">Sin datos de viajes por ahora.</p>
              : (
                <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                  <RoutesChart data={monthly} label="Viajes" />
                </Suspense>
              )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ficha del conductor</CardTitle>
            <CardAction className="flex gap-2">
              <Button type="button" variant="outline" onClick={onEdit} aria-label={`Editar a ${driver.fullName}`}>
                <Pencil data-icon="inline-start" aria-hidden="true" />Editar
              </Button>
              {canBindAccounts && (
                <Button type="button" variant="outline" onClick={onManageAccount}
                  aria-label={`${account === undefined ? 'Vincular cuenta de' : 'Cuenta de'} ${driver.fullName}`}>
                  <KeyRound data-icon="inline-start" aria-hidden="true" />{account === undefined ? 'Vincular' : 'Cuenta'}
                </Button>
              )}
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Avatar size="lg">
                <AvatarFallback className={active ? 'bg-primary/10 font-semibold text-primary' : 'font-semibold'}>{initials(driver.fullName)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-base font-semibold" title={driver.fullName}>{driver.fullName}</span>
                <Badge variant={active ? 'success' : 'secondary'}>
                  {active ? 'Activo' : 'Inactivo'}
                  {active ? <Check data-icon="inline-end" aria-hidden="true" /> : <CirclePause data-icon="inline-end" aria-hidden="true" />}
                </Badge>
              </div>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Field label="Documento"><span className="tabular-nums">{driver.documentNumber}</span></Field>
              <Field label="Licencia"><span className="tabular-nums">{driver.licenseNumber}</span></Field>
              <Field label="Teléfono">
                <a className="tabular-nums underline-offset-4 hover:text-primary hover:underline" href={`tel:${driver.phone.replace(/[^\d+]/g, '')}`}
                  aria-label={`Llamar a ${driver.fullName} al ${driver.phone}`}>{driver.phone}</a>
              </Field>
              <Field label="Registrado">{SINCE.format(new Date(driver.createdAt))}</Field>
              <Field label="Cuenta de acceso"><AccountStatus account={account} canBindAccounts={canBindAccounts} /></Field>
            </dl>
          </CardContent>
        </Card>
      </div>

      <section aria-label="Métricas del conductor" className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">Métricas de {periodLabel}</p>
        <dl className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatTile icon={CircleCheckBig} label="Completados" value={statsError ? '—' : `${NUMBER.format(totals.completed)} de ${NUMBER.format(totals.routes)}`} />
          <StatTile icon={MapPin} label="Paradas" value={statsError ? '—' : NUMBER.format(totals.stops)} />
          <StatTile icon={Package} label="Pedidos" value={statsError ? '—' : NUMBER.format(totals.orders)} />
          <StatTile icon={CalendarClock} label="Último viaje" value={statsError ? '—' : totals.lastRouteDay === null ? 'Sin viajes' : formatPlannedDate(totals.lastRouteDay)} />
        </dl>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Historial de viajes</CardTitle>
          <CardDescription>
            Rutas asignadas a {driver.fullName}, de la más reciente a la más antigua.
            {!historyLoading && !historyError && routesTotal > routes.length && ` Mostrando las ${NUMBER.format(routes.length)} más recientes de ${NUMBER.format(routesTotal)}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading
            ? <Skeleton className="h-24 w-full" aria-label="Cargando historial de viajes" />
            : <TripHistory routes={routes} vehicles={vehicles} historyError={historyError} />}
        </CardContent>
      </Card>
    </section>
  );
}

function TripHistory({ routes, vehicles, historyError }: {
  readonly routes: readonly DispatchRoute[];
  readonly vehicles: ReadonlyMap<string, Vehicle>;
  readonly historyError: boolean;
}) {
  if (historyError) return <ErrorNotice>No se pudo cargar el historial de viajes. Actualiza la página para reintentar.</ErrorNotice>;
  if (routes.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><Route aria-hidden="true" /></EmptyMedia>
          <EmptyTitle>Aún no tiene viajes</EmptyTitle>
          <EmptyDescription>Asigna este conductor al planificar una ruta en Despacho y aparecerá aquí.</EmptyDescription>
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
          <TableHead>Vehículo</TableHead>
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
            <TableCell className="tabular-nums">{vehicles.get(route.vehicleId)?.plate ?? 'Vehículo no disponible'}</TableCell>
            <TableCell className="text-right tabular-nums">{route.stops.length}</TableCell>
            <TableCell className="text-right tabular-nums">{countOrders(route)}</TableCell>
            <TableCell><Badge variant={ROUTE_BADGES[route.status]}>{ROUTE_STATUS_LABELS[route.status]}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AccountStatus({ account, canBindAccounts }: {
  readonly account: DriverAccountOption | undefined;
  readonly canBindAccounts: boolean;
}) {
  if (!canBindAccounts) return <span className="text-muted-foreground">Vinculación reservada a ADMIN</span>;
  if (account === undefined) {
    return <Badge variant="warning">Sin cuenta<CircleAlert data-icon="inline-end" aria-hidden="true" /></Badge>;
  }
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate" title={account.email}>{account.email}</span>
      {account.status === 'disabled' && <Badge variant="destructive">Cuenta desactivada</Badge>}
    </span>
  );
}
