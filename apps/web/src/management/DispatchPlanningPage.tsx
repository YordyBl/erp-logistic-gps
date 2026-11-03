import { useCallback, useEffect, useState, type FormEvent } from 'react';

import type {
  DeliveryOrder, DeliveryOrderStatusHistory, DispatchRoute, Driver, Vehicle,
} from '../api/client.js';

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

export function DispatchPlanningPage({ client }: { readonly client: DispatchClient }) {
  const [routes, setRoutes] = useState<readonly DispatchRoute[]>([]);
  const [orders, setOrders] = useState<readonly DeliveryOrder[]>([]);
  const [drivers, setDrivers] = useState<readonly Driver[]>([]);
  const [vehicles, setVehicles] = useState<readonly Vehicle[]>([]);
  const [stops, setStops] = useState<readonly StopDraft[]>([newStop()]);
  const [routeCode, setRouteCode] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [history, setHistory] = useState<Record<string, readonly DeliveryOrderStatusHistory[]>>({});
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyRouteId, setBusyRouteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
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
  const driverById = new Map(drivers.map((driver) => [driver.id, driver]));
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));

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

  return (
    <section className="dispatch-planning">
      <header className="dispatch-planning__header">
        <div>
          <p className="order-management__context">OPERACIÓN · DESPACHO</p>
          <h1>Planificación de rutas</h1>
          <p>Organiza pedidos en paradas, asigna recursos y consulta el avance de las rutas.</p>
        </div>
      </header>

      {error !== null && <p className="order-management__alert" role="alert">{error}</p>}
      {notice !== null && <p className="order-management__success" role="status">{notice}</p>}

      <section className="dispatch-planning__section" aria-labelledby="route-create-title">
        <h2 id="route-create-title">Crear ruta manual</h2>
        <form className="dispatch-planning__form" onSubmit={(event) => void createRoute(event)}>
          <label>Código de ruta
            <input required minLength={3} maxLength={32} value={routeCode} onChange={(event) => setRouteCode(event.target.value)} />
          </label>
          <label>Fecha planificada
            <input required type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} />
          </label>
          <label>Conductor
            <select required value={driverId} onChange={(event) => setDriverId(event.target.value)}>
              <option value="">Selecciona un conductor</option>
              {activeDrivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.fullName}</option>)}
            </select>
          </label>
          <label>Vehículo
            <select required value={vehicleId} onChange={(event) => setVehicleId(event.target.value)}>
              <option value="">Selecciona un vehículo</option>
              {activeVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.type}</option>)}
            </select>
          </label>

          <div className="dispatch-planning__stops">
            {stops.map((stop, stopIndex) => {
              const assignedElsewhere = new Set(stops.flatMap((item, index) => index === stopIndex ? [] : item.orderIds));
              return (
                <fieldset className="dispatch-planning__stop" key={stopIndex}>
                  <legend>Parada {stopIndex + 1}</legend>
                  <label>Dirección de parada {stopIndex + 1}
                    <input required minLength={5} maxLength={200} value={stop.addressLine}
                      onChange={(event) => updateStop(stopIndex, (current) => ({ ...current, addressLine: event.target.value }))} />
                  </label>
                  <label>Enlace de Google Maps de parada {stopIndex + 1} (opcional)
                    <input type="url" maxLength={2048} placeholder="https://maps.app.goo.gl/..."
                      value={stop.googleMapsUrl}
                      onChange={(event) => updateStop(stopIndex, (current) => ({ ...current, googleMapsUrl: event.target.value }))} />
                    <span className="dispatch-planning__field-help">Se resolverá al crear la ruta para obtener las coordenadas.</span>
                  </label>
                  <div className="dispatch-planning__orders">
                    <span>Pedidos elegibles</span>
                    {eligibleOrders.length === 0 && <p>No hay pedidos nuevos o devueltos disponibles.</p>}
                    {eligibleOrders.map((order) => {
                      const selected = stop.orderIds.includes(order.id);
                      return <div className="dispatch-planning__order" key={order.id}>
                        <label>
                          <input type="checkbox" checked={selected} disabled={assignedElsewhere.has(order.id)}
                            onChange={(event) => toggleOrder(stopIndex, order.id, event.target.checked)} />
                          <span>{order.publicCode} · {order.deliveryAddress.addressLine}</span>
                          {order.status === 'returned' && <strong>Devuelto · incidencia registrada</strong>}
                        </label>
                        {order.status === 'returned' && <button type="button" className="dispatch-planning__history-button"
                          onClick={() => void showOrderHistory(order.id)} disabled={historyLoadingId === order.id}>
                          {historyLoadingId === order.id ? 'Cargando historial…' : 'Ver historial'}
                        </button>}
                        {history[order.id]?.map((event, index) => <p className="dispatch-planning__history" key={`${event.occurredAt}-${index}`}>
                          {event.toStatus === 'returned' && <strong>Incidencia reportada · </strong>}
                          {event.fromStatus} → {event.toStatus} · {new Intl.DateTimeFormat('es-PE', {
                            dateStyle: 'medium', timeStyle: 'short',
                          }).format(new Date(event.occurredAt))}
                        </p>)}
                      </div>;
                    })}
                  </div>
                  {stops.length > 1 && <button type="button" onClick={() => setStops((current) => current.filter((_, index) => index !== stopIndex))}>
                    Eliminar parada {stopIndex + 1}
                  </button>}
                </fieldset>
              );
            })}
          </div>
          <div className="dispatch-planning__actions">
            <button type="button" onClick={() => setStops((current) => [...current, newStop()])}>Añadir parada</button>
            <button type="submit" disabled={saving || loading || activeDrivers.length === 0 || activeVehicles.length === 0}>
              {saving ? 'Creando ruta…' : 'Crear ruta'}
            </button>
          </div>
        </form>
      </section>

      <section className="dispatch-planning__section" aria-labelledby="route-list-title">
        <div className="dispatch-planning__list-heading">
          <h2 id="route-list-title">Rutas y progreso</h2>
          <button type="button" onClick={() => void loadData()} disabled={loading}>Actualizar</button>
        </div>
        {loading ? <p role="status">Cargando rutas…</p> : routes.length === 0
          ? <p>No hay rutas para mostrar.</p>
          : <div className="dispatch-planning__route-list">
            {routes.map((route) => <article className="dispatch-planning__route" key={route.id}>
              <header>
                <div><h3>{route.publicCode}</h3><p>{route.plannedDate} · {route.status === 'in_progress' ? 'En curso'
                  : route.status === 'completed' ? 'Completada' : 'Planificada'}</p></div>
                <span>{route.stops.length} {route.stops.length === 1 ? 'parada' : 'paradas'}</span>
              </header>
              <ol>{route.stops.map((stop) => <li key={stop.id}>
                {stop.addressLine} · {stop.orderIds.map((id) => {
                  const order = orderById.get(id);
                  return order === undefined ? 'Pedido' : `${order.publicCode} (${orderStatusLabel(order.status)})`;
                }).join(', ')}
              </li>)}</ol>
              <p>Conductor: {driverById.get(route.driverId)?.fullName ?? 'No disponible'} · Vehículo: {vehicleById.get(route.vehicleId)?.plate ?? 'No disponible'}</p>
              {route.status === 'planned' && <form className="dispatch-planning__reassign" onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void reassignRoute(route, String(data.get('driverId')), String(data.get('vehicleId')));
              }}>
                <label>Reasignar conductor
                  <select name="driverId" defaultValue={route.driverId}>{activeDrivers.map((driver) =>
                    <option key={driver.id} value={driver.id}>{driver.fullName}</option>)}</select>
                </label>
                <label>Reasignar vehículo
                  <select name="vehicleId" defaultValue={route.vehicleId}>{activeVehicles.map((vehicle) =>
                    <option key={vehicle.id} value={vehicle.id}>{vehicle.plate} · {vehicle.type}</option>)}</select>
                </label>
                <button type="submit" disabled={busyRouteId === route.id}>Guardar reasignación</button>
              </form>}
            </article>)}
          </div>}
      </section>
    </section>
  );
}

function orderStatusLabel(status: DeliveryOrder['status']): string {
  switch (status) {
    case 'created': return 'Creado';
    case 'planned': return 'Planificado';
    case 'assigned': return 'Asignado';
    case 'in_transit': return 'En tránsito';
    case 'delivered': return 'Entregado';
    case 'returned': return 'Devuelto · incidencia registrada';
    case 'cancelled': return 'Cancelado';
  }
}
