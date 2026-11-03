import { useCallback, useEffect, useState } from 'react';

import type { ApiClient, DeliveryOrderStatus, DispatchDashboardSummary } from '../api/client.js';

const STATUS_LABELS: Record<DeliveryOrderStatus, string> = {
  created: 'Nuevo',
  planned: 'Planificado',
  assigned: 'Asignado',
  in_transit: 'En tránsito',
  delivered: 'Entregado',
  returned: 'Devuelto',
  cancelled: 'Cancelado',
};
const STATUS_ORDER: readonly DeliveryOrderStatus[] = [
  'created', 'planned', 'assigned', 'in_transit', 'delivered', 'returned', 'cancelled',
];

type DashboardClient = Pick<ApiClient, 'getDispatchDashboardSummary'>;

export function DispatchDashboardPage({ client, onOpenOrders, onOpenDispatch, onOpenControlTower }: {
  readonly client: DashboardClient;
  readonly onOpenOrders: () => void;
  readonly onOpenDispatch: () => void;
  readonly onOpenControlTower: () => void;
}) {
  const [summary, setSummary] = useState<DispatchDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await client.getDispatchDashboardSummary());
    } catch {
      setError('No se pudo cargar el resumen operativo. Comprueba la conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  if (loading && summary === null) {
    return <section className="dispatch-dashboard"><p role="status">Cargando resumen operativo…</p></section>;
  }

  return (
    <section className="dispatch-dashboard" aria-labelledby="dispatch-dashboard-title">
      <header className="dispatch-dashboard__heading">
        <div>
          <p className="order-management__context">OPERACIÓN · RESUMEN DIARIO</p>
          <h1 id="dispatch-dashboard-title">Estado del reparto</h1>
          <p>Pedidos, rutas y resultados registrados para la operación.</p>
        </div>
        <div className="dispatch-dashboard__heading-actions">
          <span>{new Intl.DateTimeFormat('es-PE', { dateStyle: 'full', timeZone: 'America/Lima' }).format(new Date())}</span>
          <button type="button" onClick={() => void load()} disabled={loading}>Actualizar</button>
        </div>
      </header>

      {error !== null && <p className="order-management__alert" role="alert">{error}</p>}
      {summary !== null && <>
        <div className="dispatch-dashboard__kpis" aria-label="Indicadores del reparto">
          <Kpi label="Por planificar" value={summary.ordersAwaitingPlanning} detail="Pedidos nuevos o devueltos" tone="amber" />
          <Kpi label="Rutas en curso" value={summary.routesInProgress} detail="Rutas iniciadas" tone="cyan" />
          <Kpi label="Entregas de hoy" value={summary.deliveriesToday} detail="Confirmadas hoy, hora de Lima" tone="green" />
          <Kpi label="Incidencias de hoy" value={summary.incidentsToday} detail="Registradas hoy, hora de Lima" tone="orange" />
        </div>

        <div className="dispatch-dashboard__content">
          <section className="dispatch-dashboard__panel" aria-labelledby="dashboard-status-title">
            <header><div><p>VOLUMEN ACTUAL</p><h2 id="dashboard-status-title">Pedidos por estado</h2></div>
              <button type="button" onClick={onOpenOrders}>Ver pedidos</button></header>
            <ul className="dispatch-dashboard__status-list">
              {STATUS_ORDER.map((status) => {
                const count = summary.orderStatusCounts[status];
                const total = Math.max(1, ...STATUS_ORDER.map((key) => summary.orderStatusCounts[key]));
                return <li key={status}>
                  <span>{STATUS_LABELS[status]}</span>
                  <span className="dispatch-dashboard__status-track" aria-label={`${count} pedidos`}>
                    <i className={`dispatch-dashboard__status-bar dispatch-dashboard__status-bar--${status}`}
                      style={{ width: `${Math.max(0, Math.min(100, count / total * 100))}%` }} />
                  </span>
                  <strong>{count}</strong>
                </li>;
              })}
            </ul>
          </section>

          <section className="dispatch-dashboard__panel" aria-labelledby="dashboard-orders-title">
            <header><div><p>SEGUIMIENTO</p><h2 id="dashboard-orders-title">Pedidos recientes</h2></div>
              <button type="button" onClick={onOpenOrders}>Ver todos</button></header>
            {summary.recentOrders.length === 0 ? <p className="dispatch-dashboard__empty">Todavía no hay pedidos registrados.</p> :
              <ul className="dispatch-dashboard__activity-list">
                {summary.recentOrders.map((order) => <li key={order.id}>
                  <div><strong>{order.publicCode}</strong><span>{formatDateTime(order.createdAt)}</span></div>
                  <span className={`dispatch-dashboard__status-pill dispatch-dashboard__status-pill--${order.status}`}>
                    {STATUS_LABELS[order.status]}
                  </span>
                </li>)}
              </ul>}
          </section>

          <section className="dispatch-dashboard__panel dispatch-dashboard__panel--wide" aria-labelledby="dashboard-incidents-title">
            <header><div><p>ATENCIÓN OPERATIVA</p><h2 id="dashboard-incidents-title">Incidencias recientes</h2></div>
              <button type="button" onClick={onOpenDispatch}>Abrir despacho</button></header>
            {summary.recentIncidents.length === 0 ? <p className="dispatch-dashboard__empty">No hay incidencias registradas.</p> :
              <ul className="dispatch-dashboard__incident-list">
                {summary.recentIncidents.map((incident) => <li key={incident.id}>
                  <span className="dispatch-dashboard__incident-mark" aria-hidden="true">!</span>
                  <div><strong>{incident.publicCode} · {incident.category.replaceAll('_', ' ')}</strong>
                    <p>{incident.description}</p><span>{formatDateTime(incident.occurredAt)}</span></div>
                </li>)}
              </ul>}
          </section>

          <section className="dispatch-dashboard__panel dispatch-dashboard__panel--wide" aria-labelledby="dashboard-routes-title">
            <header><div><h2 id="dashboard-routes-title">Seguimiento de rutas activas</h2></div>
              <button type="button" onClick={onOpenControlTower}>Ver en torre de control</button></header>
            {summary.activeRoutes.length === 0 ? <p className="dispatch-dashboard__empty">No hay rutas en curso ahora.</p> :
              <ul className="dispatch-dashboard__route-list">
                {summary.activeRoutes.map((route) => <li key={route.id}>
                  <div><strong>{route.publicCode}</strong><span>Planificada para {route.plannedDate}</span></div>
                  {route.lastPosition === null ? <p className="dispatch-dashboard__empty">Aún no hay una posición recibida.</p> :
                    <div className="dispatch-dashboard__route-position">
                      <span>{route.lastPosition.latitude.toFixed(5)}, {route.lastPosition.longitude.toFixed(5)}</span>
                      <time dateTime={route.lastPosition.receivedAt}>Recibida {formatDateTime(route.lastPosition.receivedAt)}</time>
                    </div>}
                </li>)}
              </ul>}
          </section>
        </div>

        <footer className="dispatch-dashboard__footer">
          <p>Las cifras reflejan datos registrados. La última posición recibida no garantiza la ubicación actual; ETA no disponible.</p>
          <button type="button" onClick={onOpenControlTower}>Abrir torre de control</button>
        </footer>
      </>}
    </section>
  );
}

function Kpi({ label, value, detail, tone }: { readonly label: string; readonly value: number; readonly detail: string; readonly tone: string }) {
  return <article className={`dispatch-dashboard__kpi dispatch-dashboard__kpi--${tone}`}>
    <p>{label}</p><strong>{value.toLocaleString('es-PE')}</strong><span>{detail}</span>
  </article>;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima',
  }).format(new Date(value));
}
