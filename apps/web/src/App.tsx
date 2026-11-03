import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { ApiError, api, type AuthSession, type DeliveryEvidence, type DeliveryOrder, type DeliveryRoute, type UserRole } from './api/client.js';
import { OutcomeDialog } from './delivery/OutcomeDialog.js';
import { Button, Icon, StatusPill, Surface } from './components/Primitives.js';
import { CustomerCatalogPage } from './management/CustomerCatalogPage.js';
import { DeliveryOrderManagementPage } from './management/DeliveryOrderManagementPage.js';
import { DriverManagementPage } from './management/DriverManagementPage.js';
import { VehicleManagementPage } from './management/VehicleManagementPage.js';
import { DispatchPlanningPage } from './management/DispatchPlanningPage.js';
import { ControlTowerPage } from './management/ControlTowerPage.js';
import { DispatchDashboardPage } from './management/DispatchDashboardPage.js';

export function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.restoreSession()
      .then((restored) => { if (active) setSession(restored); })
      .catch(() => { if (active) setAuthError('No se pudo validar la sesión. Comprueba que el servicio esté disponible.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function signIn(email: string, password: string): Promise<void> {
    setAuthError(null);
    try {
      setSession(await api.login(email, password));
    } catch (error) {
      setAuthError(error instanceof ApiError && error.status === 401
        ? 'El correo o la contraseña no son correctos.'
        : 'No se pudo iniciar sesión. Inténtalo de nuevo.');
    }
  }

  async function signOut(): Promise<void> {
    await api.logout().catch(() => undefined);
    setSession(null);
  }

  if (loading) return <div className="boot-screen" role="status">Preparando tu espacio de trabajo…</div>;
  if (session === null) return <LoginScreen onSubmit={signIn} error={authError} />;

  return <Workspace session={session} onSignOut={signOut} />;
}

function LoginScreen({ onSubmit, error }: {
  readonly onSubmit: (email: string, password: string) => Promise<void>;
  readonly error: string | null;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try { await onSubmit(email.trim(), password); } finally { setBusy(false); }
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <BrandMark />
        <div className="login-copy">
          <p className="section-label">Operación Lima · Callao</p>
          <h1>La ruta sigue contigo.</h1>
          <p>Ingresa para ejecutar entregas o revisar evidencia de tus pedidos.</p>
        </div>
        <form className="login-form" onSubmit={(event) => void submit(event)}>
          <label className="field-label" htmlFor="email">Correo operativo</label>
          <input className="text-input" id="email" name="email" type="email" autoComplete="username"
            required value={email} onChange={(event) => setEmail(event.target.value)} />
          <label className="field-label" htmlFor="password">Contraseña</label>
          <input className="text-input" id="password" name="password" type="password" autoComplete="current-password"
            required value={password} onChange={(event) => setPassword(event.target.value)} />
          {error !== null && <p className="inline-error" role="alert">{error}</p>}
          <Button type="submit" disabled={busy} className="button-full">
            {busy ? 'Ingresando…' : 'Ingresar'} <Icon name="arrow" size={17} />
          </Button>
        </form>
        <p className="login-security"><Icon name="shield" size={15} /> Acceso privado · sesión protegida</p>
      </section>
      <aside className="login-aside" aria-label="Información de la plataforma">
        <div className="manifest-line"><span>RUTA</span><span>OPERACIONES</span><span>01—04</span></div>
        <div className="login-aside-copy">
          <span className="route-stamp">PE · LIMA</span>
          <p>De la salida del almacén al último destinatario, cada parada queda registrada.</p>
        </div>
        <div className="login-route-graphic" aria-hidden="true">
          <span className="route-node node-origin">ALM</span>
          <span className="route-track" />
          <span className="route-node node-stop">03</span>
          <span className="route-track route-track-short" />
          <span className="route-node node-destination"><Icon name="pin" size={18} /></span>
          <span className="route-caption">SAN ISIDRO <b>→</b> MIRAFLORES</span>
        </div>
      </aside>
    </main>
  );
}

function Workspace({ session, onSignOut }: { readonly session: AuthSession; readonly onSignOut: () => Promise<void> }) {
  const isDriver = session.user.role === 'DRIVER';
  const [activeView, setActiveView] = useState<'dashboard' | 'evidence' | 'customers' | 'orders' | 'drivers' | 'vehicles' | 'routes' | 'control-tower'>('dashboard');
  const pageTitle = isDriver ? 'Mi ruta'
    : activeView === 'dashboard' ? 'Resumen operativo'
      : activeView === 'customers' ? 'Clientes'
      : activeView === 'orders' ? 'Pedidos'
      : activeView === 'drivers' ? 'Conductores' : activeView === 'control-tower' ? 'Torre de control' : 'Evidencias';
  const currentPageTitle = activeView === 'vehicles' && !isDriver ? 'Vehículos'
    : activeView === 'routes' && !isDriver ? 'Despacho' : pageTitle;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <BrandMark compact />
        <nav className="side-nav" aria-label="Navegación principal">
          <span className="nav-heading">{isDriver ? 'EJECUCIÓN' : 'OPERACIÓN'}</span>
          {isDriver ? (
            <a className="nav-link active" href="#mi-ruta" aria-current="page"><Icon name="route" /> <span>Mi ruta</span><span className="nav-arrow">↗</span></a>
          ) : (
            <>
              <button type="button" className={`nav-link nav-link-button ${activeView === 'dashboard' ? 'active' : ''}`}
                aria-current={activeView === 'dashboard' ? 'page' : undefined} onClick={() => setActiveView('dashboard')}>
                <Icon name="route" /> <span>Resumen</span>
              </button>
              <button type="button" className={`nav-link nav-link-button ${activeView === 'control-tower' ? 'active' : ''}`}
                aria-current={activeView === 'control-tower' ? 'page' : undefined} onClick={() => setActiveView('control-tower')}>
                <Icon name="pin" /> <span>Torre de control</span>
              </button>
              <button type="button" className={`nav-link nav-link-button ${activeView === 'orders' ? 'active' : ''}`}
                aria-current={activeView === 'orders' ? 'page' : undefined} onClick={() => setActiveView('orders')}>
                <Icon name="box" /> <span>Pedidos</span>
              </button>
              <button type="button" className={`nav-link nav-link-button ${activeView === 'routes' ? 'active' : ''}`}
                aria-current={activeView === 'routes' ? 'page' : undefined} onClick={() => setActiveView('routes')}>
                <Icon name="route" /> <span>Despacho</span>
              </button>
              <button type="button" className={`nav-link nav-link-button ${activeView === 'drivers' ? 'active' : ''}`}
                aria-current={activeView === 'drivers' ? 'page' : undefined} onClick={() => setActiveView('drivers')}>
                <Icon name="route" /> <span>Conductores</span>
              </button>
              <button type="button" className={`nav-link nav-link-button ${activeView === 'vehicles' ? 'active' : ''}`}
                aria-current={activeView === 'vehicles' ? 'page' : undefined} onClick={() => setActiveView('vehicles')}>
                <Icon name="truck" /> <span>Vehículos</span>
              </button>
              <button type="button" className={`nav-link nav-link-button ${activeView === 'customers' ? 'active' : ''}`}
                aria-current={activeView === 'customers' ? 'page' : undefined} onClick={() => setActiveView('customers')}>
                <Icon name="pin" /> <span>Clientes</span>
              </button>
              <button type="button" className={`nav-link nav-link-button ${activeView === 'evidence' ? 'active' : ''}`}
                aria-current={activeView === 'evidence' ? 'page' : undefined} onClick={() => setActiveView('evidence')}>
                <Icon name="camera" /> <span>Evidencias</span>
              </button>
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          <span className="online-indicator"><i /> API conectada</span>
          <span className="build-tag">ERP LOGISTIC · MVP</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb"><span>Operaciones</span><b>/</b><strong>{currentPageTitle}</strong></div>
          <div className="user-menu">
            <span className="user-avatar">{session.user.email.slice(0, 1).toUpperCase()}</span>
            <span className="user-email">{session.user.email}</span>
            <span className="role-label">{roleLabel(session.user.role)}</span>
            <button className="icon-button sign-out" onClick={() => void onSignOut()} aria-label="Cerrar sesión" title="Cerrar sesión">
              <Icon name="logout" size={17} />
            </button>
          </div>
        </header>
        <main className="page-content" id={isDriver ? 'mi-ruta' : activeView}>
          {isDriver ? <DriverWorkspace />
            : activeView === 'dashboard' ? <DispatchDashboardPage client={api}
              onOpenOrders={() => setActiveView('orders')}
              onOpenDispatch={() => setActiveView('routes')}
              onOpenControlTower={() => setActiveView('control-tower')} />
              : activeView === 'customers' ? <CustomerCatalogPage client={api} />
              : activeView === 'orders' ? <DeliveryOrderManagementPage client={api} />
              : activeView === 'routes' ? <DispatchPlanningPage client={api} />
                : activeView === 'control-tower' ? <ControlTowerPage client={api} />
                : activeView === 'drivers' ? <DriverManagementPage client={api} canBindAccounts={session.user.role === 'ADMIN'} />
                  : activeView === 'vehicles' ? <VehicleManagementPage client={api} />
                    : <EvidenceWorkspace />}
        </main>
      </div>
    </div>
  );
}

function DriverWorkspace() {
  const [route, setRoute] = useState<DeliveryRoute | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ order: DeliveryOrder; outcome: 'delivery' | 'incident' } | null>(null);

  const loadRoute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRoute(await api.getMyRoute());
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) setRoute(null);
      else setError('No se pudo cargar la ruta. Revisa la conexión e inténtalo otra vez.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRoute(); }, [loadRoute]);

  const orders = useMemo(() => route?.stops.flatMap((stop) => stop.orders) ?? [], [route]);
  const completedOrders = orders.filter((order) => order.status === 'delivered' || order.status === 'returned').length;
  const allOutcomesRecorded = orders.length > 0 && completedOrders === orders.length;
  const progress = orders.length === 0 ? 0 : Math.round((completedOrders / orders.length) * 100);

  async function transition(action: () => Promise<DeliveryRoute>): Promise<void> {
    setBusy(true);
    setError(null);
    try { setRoute(await action()); }
    catch { setError('No se pudo actualizar la ruta. El estado no cambió; vuelve a intentarlo.'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="content-loading" role="status">Cargando ruta…</div>;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="section-label">Ejecución del conductor</p>
          <h1>Mi ruta</h1>
          <p className="page-subtitle">Cada pedido tiene su propio resultado. La ruta se cierra cuando todas las paradas están resueltas.</p>
        </div>
        <span className="date-stamp">{new Intl.DateTimeFormat('es-PE', { dateStyle: 'full', timeZone: 'America/Lima' }).format(new Date())}</span>
      </div>
      {error !== null && <div className="alert alert-danger" role="alert">{error}<button className="text-button" onClick={() => void loadRoute()}>Reintentar</button></div>}

      {route === null ? (
        <Surface className="empty-route">
          <span className="empty-mark"><Icon name="route" size={27} /></span>
          <h2>Sin ruta asignada</h2>
          <p>Cuando el operador te asigne una ruta, aparecerá aquí con sus paradas y pedidos.</p>
          <Button variant="secondary" onClick={() => void loadRoute()}>Actualizar</Button>
        </Surface>
      ) : (
        <>
          <section className="route-overview">
            <div className="route-overview-main">
              <div className="route-code-line"><span>HOJA DE RUTA</span><span>{route.publicCode}</span><StatusPill tone={route.status === 'in_progress' ? 'warning' : route.status === 'completed' ? 'success' : 'neutral'}>{routeStatusLabel(route.status)}</StatusPill></div>
              <h2>{route.stops.length} {route.stops.length === 1 ? 'parada' : 'paradas'} <span>·</span> {orders.length} {orders.length === 1 ? 'pedido' : 'pedidos'}</h2>
              <p>{route.startedAt === null ? 'Lista para iniciar' : `Iniciada ${formatTime(route.startedAt)}`}</p>
            </div>
            <div className="route-progress" aria-label={`${completedOrders} de ${orders.length} pedidos resueltos`}>
              <div className="progress-copy"><span>Progreso de pedidos</span><strong>{completedOrders}<small>/{orders.length}</small></strong></div>
              <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
              <span className="progress-note">{progress}% completado</span>
            </div>
            {route.status === 'planned' && (
              <Button onClick={() => void transition(() => api.startRoute(route.id))} disabled={busy}>
                {busy ? 'Iniciando…' : 'Iniciar ruta'} <Icon name="arrow" size={16} />
              </Button>
            )}
            {route.status === 'in_progress' && allOutcomesRecorded && (
              <Button onClick={() => void transition(() => api.completeRoute(route.id))} disabled={busy}>
                {busy ? 'Cerrando…' : 'Finalizar ruta'} <Icon name="check" size={16} />
              </Button>
            )}
            {route.status === 'completed' && <StatusPill tone="success">Ruta finalizada</StatusPill>}
          </section>

          <div className="stop-list-heading"><h2>Secuencia de paradas</h2><span>{orders.length - completedOrders} pendientes</span></div>
          <ol className="stop-list">
            {route.stops.map((stop) => (
              <li className="stop-item" key={stop.id}>
                <div className="stop-marker"><span>{String(stop.sequence).padStart(2, '0')}</span></div>
                <div className="stop-body">
                  <div className="stop-heading">
                    <div><h3>{stop.addressLine}</h3><p>{stop.orders[0]?.deliveryAddress.district ?? 'Dirección de entrega'}</p></div>
                    <span className="stop-count">{stop.orders.length} {stop.orders.length === 1 ? 'pedido' : 'pedidos'}</span>
                  </div>
                  <div className="order-list">
                    {stop.orders.map((order) => (
                      <article className="order-row" key={order.id}>
                        <div className="order-main">
                          <div className="order-code-line"><span className="order-code">{order.publicCode}</span><StatusPill tone={order.status === 'delivered' ? 'success' : order.status === 'returned' ? 'danger' : order.status === 'in_transit' ? 'warning' : 'neutral'}>{orderStatusLabel(order.status)}</StatusPill></div>
                          <h4>{order.recipient.name}</h4>
                          <p>{order.deliveryAddress.addressLine} · {order.deliveryAddress.district}</p>
                          <span className="package-note"><Icon name="box" size={14} /> {order.packages.length} {order.packages.length === 1 ? 'bulto' : 'bultos'}</span>
                        </div>
                        <div className="order-actions">
                          {route.status === 'in_progress' && order.status !== 'delivered' && order.status !== 'returned' ? (
                            <>
                              <Button className="button-compact" onClick={() => setSelected({ order, outcome: 'delivery' })}><Icon name="check" size={15} /> Entrega</Button>
                              <Button variant="quiet" className="button-compact" onClick={() => setSelected({ order, outcome: 'incident' })}>Incidencia</Button>
                            </>
                          ) : order.status === 'delivered' ? <span className="outcome-mark outcome-delivered"><Icon name="check" size={15} /> Entregado</span>
                            : order.status === 'returned' ? <span className="outcome-mark outcome-returned">Devuelto a almacén</span>
                              : <span className="muted-note">Inicia la ruta para registrar resultados</span>}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {route.status === 'in_progress' && !allOutcomesRecorded && (
            <p className="route-footnote">La ruta permanecerá abierta hasta registrar un resultado para cada pedido.</p>
          )}
        </>
      )}

      {selected !== null && <OutcomeDialog order={selected.order} client={api} outcome={selected.outcome}
        onClose={() => setSelected(null)} onComplete={async () => { setSelected(null); await loadRoute(); }} />}
    </>
  );
}

function EvidenceWorkspace() {
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<DeliveryOrder | null>(null);
  const [evidence, setEvidence] = useState<readonly DeliveryEvidence[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ readonly url: string; readonly mimeType: string } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const previewDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => () => { if (preview !== null) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    if (preview === null || previewDialog.current === null) return;
    const dialog = previewDialog.current;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      setPreview(null);
    };
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.addEventListener('cancel', handleCancel);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
    };
  }, [preview]);

  async function search(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (query.trim() === '') return;
    setLoading(true);
    setError(null);
    setOrder(null);
    setEvidence([]);
    try {
      const found = await api.findOrderByPublicCode(query);
      setOrder(found);
      setEvidence(await api.listEvidence(found.id));
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 404
        ? 'No encontramos ese pedido en tu organización.'
        : 'No se pudo consultar la evidencia. Revisa la conexión e inténtalo otra vez.');
    } finally { setLoading(false); }
  }

  async function viewEvidence(item: DeliveryEvidence): Promise<void> {
    setOpening(item.id);
    setError(null);
    try {
      const blob = await api.downloadEvidence(item.id);
      if (preview !== null) URL.revokeObjectURL(preview.url);
      setPreview({ url: URL.createObjectURL(blob), mimeType: item.mimeType });
    } catch {
      setError('No se pudo abrir la foto. Verifica tu acceso e inténtalo otra vez.');
    } finally { setOpening(null); }
  }

  return (
    <>
      <div className="page-heading">
        <div><p className="section-label">Consulta privada</p><h1>Evidencia de entrega</h1>
          <p className="page-subtitle">Busca un pedido para revisar sus fotos guardadas. El acceso se valida en cada consulta.</p></div>
        <span className="secure-stamp"><Icon name="shield" size={16} /> Solo tu organización</span>
      </div>
      <Surface className="search-surface">
        <form className="order-search" onSubmit={(event) => void search(event)}>
          <div className="search-intro"><span className="search-icon"><Icon name="search" size={19} /></span>
            <div><h2>Localizar pedido</h2><p>Ingresa el código público del pedido.</p></div></div>
          <div className="search-controls">
            <label className="visually-hidden" htmlFor="order-code">Código del pedido</label>
            <input id="order-code" className="text-input" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="Ej. LIM-2041" autoComplete="off" />
            <Button type="submit" disabled={loading || query.trim() === ''}>
              {loading ? 'Buscando…' : 'Buscar pedido'} <Icon name="arrow" size={16} />
            </Button>
          </div>
        </form>
      </Surface>
      {error !== null && <div className="alert alert-danger" role="alert">{error}</div>}
      {order !== null && (
        <Surface className="evidence-result">
          <div className="result-heading">
            <div><p className="section-label">{order.publicCode} · {order.status === 'delivered' ? 'ENTREGA COMPLETADA' : orderStatusLabel(order.status).toUpperCase()}</p>
              <h2>{order.recipient.name}</h2><p>{order.deliveryAddress.addressLine}, {order.deliveryAddress.district}</p></div>
            <StatusPill tone={order.status === 'delivered' ? 'success' : 'neutral'}>{orderStatusLabel(order.status)}</StatusPill>
          </div>
          <div className="evidence-list-heading"><h3>Fotos registradas</h3><span>{evidence.length} archivos</span></div>
          {evidence.length === 0 ? (
            <div className="evidence-empty"><Icon name="camera" size={22} /><p>Este pedido aún no tiene fotos disponibles.</p></div>
          ) : (
            <div className="evidence-table" role="table" aria-label="Evidencias del pedido">
              <div className="evidence-table-head" role="row"><span>Archivo</span><span>Fecha de carga</span><span>Estado</span><span /></div>
              {evidence.map((item, index) => (
                <div className="evidence-table-row" role="row" key={item.id}>
                  <span className="evidence-file"><span className="file-mark"><Icon name="camera" size={16} /></span><span><strong>Foto {index + 1}</strong><small>{item.mimeType.replace('image/', '').toUpperCase()} · {formatBytes(item.byteSize)}</small></span></span>
                  <time>{formatDate(item.createdAt)}</time>
                  <StatusPill tone={item.status === 'available' ? 'success' : 'warning'}>{item.status === 'available' ? 'Disponible' : 'En proceso'}</StatusPill>
                  {item.status === 'available' ? <Button variant="quiet" className="button-compact" disabled={opening === item.id} onClick={() => void viewEvidence(item)}>{opening === item.id ? 'Abriendo…' : 'Ver foto'}</Button>
                    : <span className="muted-note">No disponible</span>}
                </div>
              ))}
            </div>
          )}
          <p className="retention-note"><Icon name="shield" size={15} /> Las fotos guardadas se conservan; esta vista no permite eliminarlas.</p>
        </Surface>
      )}
      {preview !== null && (
        <dialog ref={previewDialog} className="image-dialog" aria-label="Vista de evidencia" aria-modal="true">
          <div className="image-dialog-head"><span>Vista privada · {preview.mimeType}</span>
            <button className="icon-button" onClick={() => setPreview(null)} aria-label="Cerrar foto"><Icon name="close" /></button></div>
          <img src={preview.url} alt="Evidencia fotográfica del pedido" />
        </dialog>
      )}
    </>
  );
}

function BrandMark({ compact = false }: { readonly compact?: boolean }) {
  return <div className={`brand-mark ${compact ? 'brand-compact' : ''}`}>
    <span className="brand-symbol" aria-hidden="true"><span /><span /><span /></span>
    <span className="brand-name">ERP<span className="brand-dot">·</span>LOGISTIC<small>ÚLTIMA MILLA · LIMA</small></span>
  </div>;
}

function roleLabel(role: UserRole): string {
  return role === 'DRIVER' ? 'CONDUCTOR' : role === 'ADMIN' ? 'ADMINISTRACIÓN' : 'OPERADOR';
}

function routeStatusLabel(status: DeliveryRoute['status']): string {
  return status === 'in_progress' ? 'En curso' : status === 'completed' ? 'Completada' : 'Planificada';
}

function orderStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    created: 'Creado', planned: 'Planificado', assigned: 'Asignado', in_transit: 'En reparto',
    delivered: 'Entregado', returned: 'Devuelto', cancelled: 'Cancelado',
  };
  return labels[status] ?? status;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(value));
}

function formatBytes(value: number): string {
  return value < 1_000_000
    ? `${Math.max(1, Math.round(value / 1_000))} KB`
    : `${(value / 1_000_000).toFixed(2)} MB`;
}
