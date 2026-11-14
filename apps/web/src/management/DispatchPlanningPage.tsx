import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeftRight, Eye, Plus, RefreshCw, Route } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import type {
  DeliveryOrder, DeliveryOrderStatusHistory, DispatchRoute, Driver, Vehicle,
} from '../api/client.js';
import { RowActions, SortableHeader, TableProgress } from '../components/data-table/columnHelpers.js';
import { DataTable, type DataTableFilter } from '../components/data-table/DataTable.js';
import { DocumentSheet, DocumentTitle, FormSheet } from '../components/FormSheet.js';
import { DateField, SelectField, TextField } from '../components/FormFields.js';
import { IconChip } from '../components/IconChip.js';
import { ErrorNotice, LoadingRows, SuccessNotice } from '../components/Notices.js';
import { PageHeader } from '../components/PageHeader.js';
import { Avatar, AvatarFallback } from '../components/ui/avatar.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { DropdownMenuItem } from '../components/ui/dropdown-menu.js';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '../components/ui/field.js';
import { Input } from '../components/ui/input.js';
import { Separator } from '../components/ui/separator.js';
import { ORDER_STATUS_LABELS, ROUTE_BADGES, ROUTE_STATUS_LABELS } from '../delivery/orderStatus.js';
import { formatPlannedDate } from '../lib/dates.js';
import { countLabel, formatDateTime, initials } from '../lib/format.js';
import { RouteTimeline } from './routes/RouteTimeline.js';
import { summarizeRoute, type RouteProgress } from './routes/routeProgress.js';

interface RouteRow {
  readonly route: DispatchRoute;
  readonly progress: RouteProgress;
  readonly driver: string;
  readonly plate: string;
}

const ROUTE_STATUS_FILTER: DataTableFilter = {
  columnId: 'status',
  title: 'Estado',
  options: (['planned', 'in_progress', 'completed'] as const).map((status) => ({ value: status, label: ROUTE_STATUS_LABELS[status] })),
};

interface DispatchClient {
  listDispatchRoutes(): Promise<readonly DispatchRoute[]>;
  listDeliveryOrders(): Promise<readonly DeliveryOrder[]>;
  listDrivers(): Promise<readonly Driver[]>;
  listVehicles(): Promise<readonly Vehicle[]>;
  createDispatchRoute(input: {
    readonly publicCode: string;
    readonly plannedDate: string;
    readonly driverId: string;
    readonly vehicleId: string;
    readonly stops: readonly {
      readonly sequence: number;
      readonly addressLine: string;
      readonly googleMapsUrl?: string;
      readonly orderIds: readonly string[];
    }[];
  }): Promise<DispatchRoute>;
  reassignDispatchRoute(routeId: string, input: {
    readonly driverId?: string;
    readonly vehicleId?: string;
  }): Promise<DispatchRoute>;
  listDeliveryOrderStatusHistory(orderId: string): Promise<readonly DeliveryOrderStatusHistory[]>;
}

interface StopDraft {
  readonly addressLine: string;
  readonly googleMapsUrl: string;
  readonly orderIds: readonly string[];
}

const newStop = (): StopDraft => ({ addressLine: '', googleMapsUrl: '', orderIds: [] });

function driverOptions(drivers: readonly Driver[]) {
  return drivers.map((driver) => ({ value: driver.id, label: driver.fullName }));
}

function vehicleOptions(vehicles: readonly Vehicle[]) {
  return vehicles.map((vehicle) => ({ value: vehicle.id, label: `${vehicle.plate} · ${vehicle.type}` }));
}

export function DispatchPlanningPage({ client }: { readonly client: DispatchClient }) {
  const [routes, setRoutes] = useState<readonly DispatchRoute[]>([]);
  const [orders, setOrders] = useState<readonly DeliveryOrder[]>([]);
  const [drivers, setDrivers] = useState<readonly Driver[]>([]);
  const [vehicles, setVehicles] = useState<readonly Vehicle[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailRouteId, setDetailRouteId] = useState<string | null>(null);
  const [reassignRouteId, setReassignRouteId] = useState<string | null>(null);
  const [stops, setStops] = useState<readonly StopDraft[]>([newStop()]);
  const [routeCode, setRouteCode] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [showMissing, setShowMissing] = useState(false);
  const [history, setHistory] = useState<Record<string, readonly DeliveryOrderStatusHistory[]>>({});
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyRouteId, setBusyRouteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    try {
      const [loadedRoutes, loadedOrders, loadedDrivers, loadedVehicles] = await Promise.all([
        client.listDispatchRoutes(), client.listDeliveryOrders(), client.listDrivers(), client.listVehicles(),
      ]);
      setRoutes(loadedRoutes);
      setOrders(loadedOrders);
      setDrivers(loadedDrivers);
      setVehicles(loadedVehicles);
    } catch {
      setLoadFailed(true);
      setError('No se pudo cargar la información de despacho. Comprueba la conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void loadData(); }, [loadData]);

  const eligibleOrders = orders.filter((order) => order.status === 'created' || order.status === 'returned');
  const activeDrivers = drivers.filter((driver) => driver.status === 'active');
  const activeVehicles = vehicles.filter((vehicle) => vehicle.status === 'active');
  const orderById = new Map(orders.map((order) => [order.id, order]));

  function updateStop(index: number, update: (stop: StopDraft) => StopDraft) {
    setStops((current) => current.map((stop, stopIndex) => stopIndex === index ? update(stop) : stop));
  }

  function toggleOrder(stopIndex: number, orderId: string, checked: boolean) {
    setStops((current) => current.map((stop, index) => {
      if (index !== stopIndex) return { ...stop, orderIds: stop.orderIds.filter((id) => id !== orderId) };
      return {
        ...stop,
        orderIds: checked ? [...stop.orderIds, orderId] : stop.orderIds.filter((id) => id !== orderId),
      };
    }));
  }

  async function showOrderHistory(orderId: string) {
    setHistoryLoadingId(orderId);
    try {
      const events = await client.listDeliveryOrderStatusHistory(orderId);
      setHistory((current) => ({ ...current, [orderId]: events }));
    } catch {
      setError('No se pudo cargar el historial del pedido.');
    } finally {
      setHistoryLoadingId(null);
    }
  }

  async function createRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (plannedDate === '' || driverId === '' || vehicleId === '') {
      setShowMissing(true);
      return;
    }
    if (stops.some((stop) => stop.orderIds.length === 0)) {
      setError('Asigna al menos un pedido a cada parada antes de crear la ruta.');
      return;
    }
    setSaving(true);
    try {
      const created = await client.createDispatchRoute({
        publicCode: routeCode.trim(), plannedDate, driverId, vehicleId,
        stops: stops.map((stop, index) => ({
          sequence: index + 1, addressLine: stop.addressLine.trim(), orderIds: stop.orderIds,
          ...(stop.googleMapsUrl.trim() === '' ? {} : { googleMapsUrl: stop.googleMapsUrl.trim() }),
        })),
      });
      setRoutes((current) => [...current, created]);
      setOrders((current) => current.map((order) => stops.some((stop) => stop.orderIds.includes(order.id))
        ? { ...order, status: 'assigned' } : order));
      setRouteCode('');
      setPlannedDate('');
      setDriverId('');
      setVehicleId('');
      setStops([newStop()]);
      setShowMissing(false);
      setCreateOpen(false);
      setNotice(`Ruta ${created.publicCode} creada.`);
    } catch (cause) {
      setError(cause instanceof Error ? `No se pudo crear la ruta. ${cause.message}` : 'No se pudo crear la ruta.');
    } finally {
      setSaving(false);
    }
  }

  async function reassignRoute(route: DispatchRoute, nextDriverId: string, nextVehicleId: string) {
    const changes = {
      ...(nextDriverId === route.driverId ? {} : { driverId: nextDriverId }),
      ...(nextVehicleId === route.vehicleId ? {} : { vehicleId: nextVehicleId }),
    };
    if (Object.keys(changes).length === 0) {
      setNotice('No se seleccionaron recursos diferentes.');
      return;
    }
    setBusyRouteId(route.id);
    setError(null);
    try {
      const updated = await client.reassignDispatchRoute(route.id, changes);
      setRoutes((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice(`Recursos de ${updated.publicCode} actualizados.`);
    } catch (cause) {
      setError(cause instanceof Error ? `No se pudo reasignar la ruta. ${cause.message}` : 'No se pudo reasignar la ruta.');
    } finally {
      setBusyRouteId(null);
    }
  }

  const routeRows = useMemo<readonly RouteRow[]>(() => {
    const orderMap = new Map(orders.map((order) => [order.id, order]));
    return routes.map((route) => ({
      route,
      progress: summarizeRoute(route, orderMap),
      driver: drivers.find((driver) => driver.id === route.driverId)?.fullName ?? 'Conductor no disponible',
      plate: vehicles.find((vehicle) => vehicle.id === route.vehicleId)?.plate ?? 'Vehículo no disponible',
    }));
  }, [drivers, orders, routes, vehicles]);

  const columns = useMemo<readonly ColumnDef<RouteRow, unknown>[]>(() => [
    {
      id: 'code',
      accessorFn: (row) => row.route.publicCode,
      header: ({ column }) => <SortableHeader column={column} title="Ruta" />,
      enableHiding: false,
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-medium tabular-nums">{row.original.route.publicCode}</span>
          <span className="text-xs text-muted-foreground">{formatPlannedDate(row.original.route.plannedDate)}</span>
        </span>
      ),
    },
    {
      id: 'driver',
      accessorFn: (row) => row.driver,
      header: ({ column }) => <SortableHeader column={column} title="Conductor" />,
      meta: { title: 'Conductor', className: 'hidden md:table-cell' },
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <Avatar size="sm"><AvatarFallback>{initials(row.original.driver)}</AvatarFallback></Avatar>
          {row.original.driver}
        </span>
      ),
    },
    {
      id: 'plate',
      accessorFn: (row) => row.plate,
      header: 'Vehículo',
      meta: { title: 'Vehículo', className: 'hidden md:table-cell tabular-nums' },
    },
    {
      id: 'stops',
      accessorFn: (row) => row.route.stops.length,
      header: 'Paradas',
      enableGlobalFilter: false,
      meta: { title: 'Paradas', className: 'hidden md:table-cell tabular-nums' },
    },
    {
      id: 'status',
      accessorFn: (row) => row.route.status,
      header: 'Estado',
      filterFn: 'arrIncludesSome',
      enableGlobalFilter: false,
      meta: { title: 'Estado' },
      cell: ({ row }) => <Badge variant={ROUTE_BADGES[row.original.route.status]}>{ROUTE_STATUS_LABELS[row.original.route.status]}</Badge>,
    },
    {
      id: 'progress',
      accessorFn: (row) => row.progress.percent,
      header: ({ column }) => <SortableHeader column={column} title="Avance" />,
      enableGlobalFilter: false,
      meta: { title: 'Avance' },
      cell: ({ row }) => {
        const { closed, total, percent } = row.original.progress;
        return <TableProgress percent={percent} detail={`${closed} de ${total}`} label={`Avance de ${row.original.route.publicCode}`} />;
      },
    },
    {
      id: 'actions',
      enableHiding: false,
      cell: ({ row }) => (
        <RowActions label={`Acciones de ${row.original.route.publicCode}`}>
          <DropdownMenuItem onSelect={() => setDetailRouteId(row.original.route.id)}><Eye aria-hidden="true" /> Ver detalle</DropdownMenuItem>
          {row.original.route.status === 'planned' && (
            <DropdownMenuItem onSelect={() => setReassignRouteId(row.original.route.id)}><ArrowLeftRight aria-hidden="true" /> Reasignar</DropdownMenuItem>
          )}
        </RowActions>
      ),
    },
  ], []);

  const detailRow = routeRows.find((row) => row.route.id === detailRouteId);
  const reassignRoute_ = routes.find((route) => route.id === reassignRouteId);

  function openCreate() {
    setError(null);
    setNotice(null);
    setCreateOpen(true);
  }

  const routeCounts = {
    inProgress: routes.filter((route) => route.status === 'in_progress').length,
    planned: routes.filter((route) => route.status === 'planned').length,
    completed: routes.filter((route) => route.status === 'completed').length,
  };

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Planificación de rutas" description={!loading && !loadFailed ? `${countLabel(eligibleOrders.length, 'pedido', 'pedidos')} por asignar · ${countLabel(routeCounts.inProgress, 'ruta', 'rutas')} en curso · ${countLabel(routeCounts.planned, 'planificada', 'planificadas')} · ${countLabel(routeCounts.completed, 'finalizada', 'finalizadas')}.` : 'Organiza pedidos en paradas, asigna recursos y consulta el avance de las rutas.'}>
        <Button type="button" variant="outline" onClick={() => void loadData()} disabled={loading}>
          <RefreshCw data-icon="inline-start" aria-hidden="true" /> Actualizar
        </Button>
        <Button type="button" onClick={openCreate}><Plus data-icon="inline-start" aria-hidden="true" /> Nueva ruta</Button>
      </PageHeader>

      {!createOpen && error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      <FormSheet open={createOpen} onOpenChange={setCreateOpen} width="wide" paper title="Crear ruta manual"
        description="Asigna conductor y vehículo, y agrupa los pedidos en paradas."
        onSubmit={(event) => void createRoute(event)}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={saving || loading || activeDrivers.length === 0 || activeVehicles.length === 0}>
              {saving ? 'Creando ruta…' : 'Crear ruta'}
            </Button>
          </>
        )}>
            <DocumentTitle title="HOJA DE RUTA" aside={<IconChip icon={Route} tone="primary" />}>
              <span>Paradas: <span className="text-foreground">{stops.length}</span></span>
              <span>Pedidos asignados: <span className="text-foreground">{stops.reduce((total, stop) => total + stop.orderIds.length, 0)}</span></span>
            </DocumentTitle>
            {error !== null && <ErrorNotice>{error}</ErrorNotice>}
            <FieldGroup className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <TextField id="route-code" label="Código de ruta" placeholder="Ej. R-2041" required minLength={3} maxLength={32} value={routeCode}
                onChange={(event) => setRouteCode(event.target.value)} />
              <DateField id="route-date" label="Fecha planificada" placeholder="Elige una fecha" value={plannedDate} onChange={setPlannedDate}
                error={showMissing && plannedDate === '' ? 'Elige la fecha planificada.' : null} />
              <SelectField id="route-driver" label="Conductor" placeholder="Selecciona un conductor" value={driverId}
                options={driverOptions(activeDrivers)} onChange={setDriverId}
                error={showMissing && driverId === '' ? 'Selecciona un conductor.' : null} />
              <SelectField id="route-vehicle" label="Vehículo" placeholder="Selecciona un vehículo" value={vehicleId}
                options={vehicleOptions(activeVehicles)} onChange={setVehicleId}
                error={showMissing && vehicleId === '' ? 'Selecciona un vehículo.' : null} />
            </FieldGroup>

            {stops.map((stop, stopIndex) => {
              const assignedElsewhere = new Set(stops.flatMap((item, index) => index === stopIndex ? [] : item.orderIds));
              return (
                <FieldSet key={stopIndex}>
                  <FieldLegend>Parada {stopIndex + 1}</FieldLegend>
                  <FieldGroup className="gap-4">
                    <TextField id={`stop-address-${stopIndex}`} label={`Dirección de parada ${stopIndex + 1}`} placeholder="Ej. Av. Arequipa 123, Lince" required minLength={5} maxLength={200}
                      value={stop.addressLine} onChange={(event) => updateStop(stopIndex, (current) => ({ ...current, addressLine: event.target.value }))} />
                    <Field>
                      <FieldLabel htmlFor={`stop-maps-${stopIndex}`}>Enlace de Google Maps de parada {stopIndex + 1} (opcional)</FieldLabel>
                      <Input id={`stop-maps-${stopIndex}`} type="url" maxLength={2048} placeholder="https://maps.app.goo.gl/..." value={stop.googleMapsUrl}
                        onChange={(event) => updateStop(stopIndex, (current) => ({ ...current, googleMapsUrl: event.target.value }))} />
                      <FieldDescription>Se resolverá al crear la ruta para obtener las coordenadas.</FieldDescription>
                    </Field>
                    <FieldSet>
                      <FieldLegend variant="label">Pedidos elegibles</FieldLegend>
                      {eligibleOrders.length === 0 && <FieldDescription>No hay pedidos creados o devueltos disponibles.</FieldDescription>}
                      <FieldGroup className="gap-3">
                        {eligibleOrders.map((order) => {
                          const checkboxId = `stop-${stopIndex}-order-${order.id}`;
                          return (
                            <div key={order.id} className="flex flex-col gap-2">
                              <Field orientation="horizontal">
                                <Checkbox id={checkboxId} checked={stop.orderIds.includes(order.id)} disabled={assignedElsewhere.has(order.id)}
                                  onCheckedChange={(checked) => toggleOrder(stopIndex, order.id, checked === true)} />
                                <FieldLabel htmlFor={checkboxId} className="font-normal">{order.publicCode} · {order.deliveryAddress.addressLine}</FieldLabel>
                              </Field>
                              {order.status === 'returned' && (
                                <div className="flex flex-wrap items-center gap-2 pl-6">
                                  <Badge variant="destructive">Devuelto · incidencia registrada</Badge>
                                  <Button type="button" variant="outline" onClick={() => void showOrderHistory(order.id)} disabled={historyLoadingId === order.id}>
                                    {historyLoadingId === order.id ? 'Cargando historial…' : 'Ver historial'}
                                  </Button>
                                </div>
                              )}
                              {history[order.id]?.map((event, index) => (
                                <p key={`${event.occurredAt}-${index}`} className="pl-6 text-sm text-muted-foreground">
                                  {event.toStatus === 'returned' && <strong>Incidencia reportada · </strong>}
                                  {event.fromStatus} → {event.toStatus} · {formatDateTime(event.occurredAt)}
                                </p>
                              ))}
                            </div>
                          );
                        })}
                      </FieldGroup>
                    </FieldSet>
                    {stops.length > 1 && (
                      <div>
                        <Button type="button" variant="outline" onClick={() => setStops((current) => current.filter((_, index) => index !== stopIndex))}>
                          Eliminar parada {stopIndex + 1}
                        </Button>
                      </div>
                    )}
                  </FieldGroup>
                  <Separator />
                </FieldSet>
              );
            })}

            <div>
              <Button type="button" variant="ghost" onClick={() => setStops((current) => [...current, newStop()])}>
                <Plus data-icon="inline-start" aria-hidden="true" /> Añadir parada
              </Button>
            </div>
      </FormSheet>

      {loading && <LoadingRows label="Cargando rutas…" />}
      {!loading && !loadFailed && routes.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Route aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>No hay rutas para mostrar.</EmptyTitle>
            <EmptyDescription>
              {eligibleOrders.length > 0
                ? `Tienes ${eligibleOrders.length.toLocaleString('es-PE')} ${eligibleOrders.length === 1 ? 'pedido listo' : 'pedidos listos'} para agrupar en paradas.`
                : 'Cuando haya pedidos nuevos, podrás agruparlos en paradas y asignarlos a un conductor.'}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button type="button" onClick={openCreate}>Crear primera ruta</Button></EmptyContent>
        </Empty>
      )}
      {!loading && routes.length > 0 && (
        <DataTable label="Rutas y progreso" columns={columns} data={routeRows} searchPlaceholder="Buscar ruta, conductor o placa"
          filters={[ROUTE_STATUS_FILTER]} onRowClick={(row) => setDetailRouteId(row.route.id)} />
      )}

      <DocumentSheet open={detailRow !== undefined} onOpenChange={(open) => { if (!open) setDetailRouteId(null); }}
        title={detailRow?.route.publicCode ?? 'Ruta'} description="Paradas, pedidos y avance de la ruta."
        {...(detailRow?.route.status === 'planned' ? {
          footer: <Button type="button" variant="outline" onClick={() => { setReassignRouteId(detailRow.route.id); setDetailRouteId(null); }}><ArrowLeftRight data-icon="inline-start" aria-hidden="true" /> Reasignar</Button>,
        } : {})}>
        {detailRow !== undefined && (
          <>
            <DocumentTitle title="HOJA DE RUTA" aside={<Badge variant={ROUTE_BADGES[detailRow.route.status]}>{ROUTE_STATUS_LABELS[detailRow.route.status]}</Badge>}>
              <span>N°: <span className="text-foreground">{detailRow.route.publicCode}</span></span>
              <span>Fecha: <span className="text-foreground">{formatPlannedDate(detailRow.route.plannedDate)}</span></span>
              <span>Conductor: <span className="text-foreground">{detailRow.driver}</span></span>
              <span>Vehículo: <span className="text-foreground">{detailRow.plate}</span></span>
            </DocumentTitle>
            <TableProgress percent={detailRow.progress.percent} label={`Avance de ${detailRow.route.publicCode}`}
              detail={`${detailRow.progress.closed} de ${detailRow.progress.total} ${detailRow.progress.total === 1 ? 'pedido cerrado' : 'pedidos cerrados'}`} />
            <div className="text-xs">
              <RouteTimeline stops={detailRow.route.stops.map((stop, index) => ({
                id: stop.id,
                addressLine: stop.addressLine,
                state: detailRow.progress.stopStates[index] ?? 'pending',
                detail: stop.orderIds.map((id) => {
                  const order = orderById.get(id);
                  return order === undefined ? 'Pedido' : `${order.publicCode} (${orderStatusLabel(order.status)})`;
                }).join(', '),
              }))} />
            </div>
          </>
        )}
      </DocumentSheet>

      {reassignRoute_ !== undefined && (
        <ReassignSheet key={`${reassignRoute_.id}-${reassignRoute_.driverId}-${reassignRoute_.vehicleId}`} route={reassignRoute_} drivers={activeDrivers} vehicles={activeVehicles} busy={busyRouteId === reassignRoute_.id}
          onClose={() => setReassignRouteId(null)}
          onSubmit={(nextDriverId, nextVehicleId) => { setReassignRouteId(null); void reassignRoute(reassignRoute_, nextDriverId, nextVehicleId); }} />
      )}
    </section>
  );
}

function ReassignSheet({ route, drivers, vehicles, busy, onClose, onSubmit }: {
  readonly route: DispatchRoute;
  readonly drivers: readonly Driver[];
  readonly vehicles: readonly Vehicle[];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (driverId: string, vehicleId: string) => void;
}) {
  const [driverId, setDriverId] = useState(route.driverId);
  const [vehicleId, setVehicleId] = useState(route.vehicleId);

  return (
    <FormSheet open onOpenChange={(open) => { if (!open) onClose(); }} title={`Reasignar ${route.publicCode}`}
      description="Cambia el conductor o el vehículo mientras la ruta no haya iniciado."
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(driverId, vehicleId);
      }}
      footer={(
        <>
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy}>Guardar reasignación</Button>
        </>
      )}>
      <FieldGroup className="gap-4">
        <SelectField id={`reassign-driver-${route.id}`} label="Reasignar conductor" placeholder="Selecciona un conductor" value={driverId}
          options={driverOptions(drivers)} onChange={setDriverId} />
        <SelectField id={`reassign-vehicle-${route.id}`} label="Reasignar vehículo" placeholder="Selecciona un vehículo" value={vehicleId}
          options={vehicleOptions(vehicles)} onChange={setVehicleId} />
      </FieldGroup>
    </FormSheet>
  );
}

function orderStatusLabel(status: DeliveryOrder['status']): string {
  return status === 'returned' ? 'Devuelto · incidencia registrada' : ORDER_STATUS_LABELS[status];
}
