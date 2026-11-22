import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';

import { ApiError, api, type AuthSession } from './api/client.js';
import { LoginScreen } from './auth/LoginScreen.js';
import { BrandMark } from './components/BrandMark.js';
import { Button } from './components/ui/button.js';
import { Spinner } from './components/ui/spinner.js';
import { DriverWorkspace } from './delivery/DriverWorkspace.js';
import { EvidenceWorkspace } from './delivery/EvidenceWorkspace.js';
import { ControlTowerPage } from './management/ControlTowerPage.js';
import { CustomerCatalogPage } from './management/CustomerCatalogPage.js';
import { DeliveryOrderManagementPage } from './management/DeliveryOrderManagementPage.js';
import { DispatchDashboardPage } from './management/DispatchDashboardPage.js';
import { DispatchPlanningPage } from './management/DispatchPlanningPage.js';
import { DriverManagementPage } from './management/DriverManagementPage.js';
import { OrdersPage } from './management/OrdersPage.js';
import { VehicleManagementPage } from './management/VehicleManagementPage.js';
import { AppShell } from './shell/AppShell.js';
import { IncidentNotifications } from './shell/IncidentNotifications.js';
import { APP_BASE, orderPath, viewFromPath, viewPath, viewSegment, type OperatorView } from './shell/navigation.js';

/**
 * `/` belongs to the public site (still to come) and the ERP lives under `/app`.
 * The router itself is provided by `main.tsx` (and by `MemoryRouter` in tests).
 */
export function App() {
  return (
    <Routes>
      <Route path={`${APP_BASE}/*`} element={<ErpApp />} />
      <Route path="*" element={<Navigate to={APP_BASE} replace />} />
    </Routes>
  );
}

function ErpApp() {
  const navigate = useNavigate();
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
    // The next account must not land on the previous one's screen.
    void navigate(APP_BASE, { replace: true });
  }

  if (loading) return <BootScreen />;
  if (session === null) return <LoginScreen onSubmit={signIn} error={authError} />;

  return <Workspace session={session} onSignOut={signOut} />;
}

function BootScreen() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4" role="status">
      <BrandMark />
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner aria-hidden="true" /> Preparando tu espacio de trabajo…</p>
    </div>
  );
}

function Workspace({ session, onSignOut }: { readonly session: AuthSession; readonly onSignOut: () => Promise<void> }) {
  const navigate = useNavigate();
  const activeView = viewFromPath(useLocation().pathname);

  if (session.user.role === 'DRIVER') {
    return (
      <AppShell session={session} activeView={activeView} pageId="mi-ruta" onSignOut={() => void onSignOut()}>
        <Routes>
          <Route index element={<DriverWorkspace client={api} />} />
          <Route path="*" element={<Navigate to={APP_BASE} replace />} />
        </Routes>
      </AppShell>
    );
  }

  return (
    <AppShell session={session} activeView={activeView} pageId={activeView}
      headerActions={(
        <IncidentNotifications client={api} refreshKey={activeView}
          onOpenOrder={(code) => void navigate(orderPath(code))} onOpenDispatch={() => void navigate(viewPath('routes'))} />
      )}
      onSignOut={() => void onSignOut()}>
      <OperatorRoutes session={session} />
    </AppShell>
  );
}

function OperatorRoutes({ session }: { readonly session: AuthSession }) {
  const navigate = useNavigate();
  const goTo = (view: OperatorView) => () => void navigate(viewPath(view));

  return (
    <Routes>
      <Route index element={(
        <DispatchDashboardPage client={api} userName={session.user.email.split('@')[0] ?? ''} onOpenOrders={goTo('orders')}
          onOpenDispatch={goTo('routes')} onOpenControlTower={goTo('control-tower')} />
      )} />
      <Route path={viewSegment('control-tower')} element={<ControlTowerPage client={api} />} />
      <Route path={`${viewSegment('orders')}/:codigo?`} element={<OrdersRoute />} />
      <Route path={viewSegment('orders-manage')} element={(
        <>
          <div>
            <Button variant="ghost" onClick={goTo('orders')}>
              <ArrowLeft data-icon="inline-start" aria-hidden="true" /> Volver a pedidos
            </Button>
          </div>
          <DeliveryOrderManagementPage client={api} />
        </>
      )} />
      <Route path={viewSegment('routes')} element={<DispatchPlanningPage client={api} />} />
      <Route path={viewSegment('drivers')} element={<DriverManagementPage client={api} canBindAccounts={session.user.role === 'ADMIN'} />} />
      <Route path={viewSegment('vehicles')} element={<VehicleManagementPage client={api} />} />
      <Route path={viewSegment('customers')} element={<CustomerCatalogPage client={api} />} />
      <Route path={viewSegment('evidence')} element={<EvidenceWorkspace client={api} />} />
      <Route path="*" element={<Navigate to={APP_BASE} replace />} />
    </Routes>
  );
}

/** Pedidos with the order detail driven by `/app/pedidos/:codigo`, so it can be shared and reloaded. */
function OrdersRoute() {
  const navigate = useNavigate();
  const { codigo } = useParams();
  return (
    <OrdersPage client={api} selectedCode={codigo ?? null}
      onSelectOrder={(code) => void navigate(code === null ? viewPath('orders') : orderPath(code))}
      onManage={() => void navigate(viewPath('orders-manage'))} />
  );
}
