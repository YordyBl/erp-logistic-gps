import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';

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
import type { OperatorView } from './shell/navigation.js';
import { useSidebarOrders } from './shell/useSidebarOrders.js';

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
  const isDriver = session.user.role === 'DRIVER';
  const [activeView, setActiveView] = useState<OperatorView>('dashboard');
  const [selectedOrderCode, setSelectedOrderCode] = useState<string | null>(null);
  const sidebarOrders = useSidebarOrders(api);

  function openOrder(code: string): void {
    setSelectedOrderCode(code);
    setActiveView('orders');
  }

  return (
    <AppShell session={session} activeView={activeView} pageId={isDriver ? 'mi-ruta' : activeView}
      headerActions={isDriver ? undefined : (
        <IncidentNotifications client={api} refreshKey={activeView} onOpenOrder={openOrder} onOpenDispatch={() => setActiveView('routes')} />
      )}
      orders={sidebarOrders} selectedOrderCode={selectedOrderCode}
      onNavigate={setActiveView} onOpenOrder={openOrder} onSignOut={() => void onSignOut()}
      onToggleOrders={() => { setActiveView('orders'); void sidebarOrders.toggle(); }}>
      {isDriver ? <DriverWorkspace client={api} /> : <OperatorPage view={activeView} session={session} selectedOrderCode={selectedOrderCode}
        onNavigate={setActiveView} onSelectOrder={setSelectedOrderCode} />}
    </AppShell>
  );
}

function OperatorPage({ view, session, selectedOrderCode, onNavigate, onSelectOrder }: {
  readonly view: OperatorView;
  readonly session: AuthSession;
  readonly selectedOrderCode: string | null;
  readonly onNavigate: (view: OperatorView) => void;
  readonly onSelectOrder: (code: string | null) => void;
}) {
  switch (view) {
    case 'dashboard':
      return <DispatchDashboardPage client={api} userName={session.user.email.split('@')[0] ?? ''} onOpenOrders={() => onNavigate('orders')}
        onOpenDispatch={() => onNavigate('routes')} onOpenControlTower={() => onNavigate('control-tower')} />;
    case 'customers':
      return <CustomerCatalogPage client={api} />;
    case 'orders':
      return <OrdersPage client={api} selectedCode={selectedOrderCode} onSelectOrder={onSelectOrder} onManage={() => onNavigate('orders-manage')} />;
    case 'orders-manage':
      return (
        <>
          <div>
            <Button variant="ghost" onClick={() => onNavigate('orders')}>
              <ArrowLeft data-icon="inline-start" aria-hidden="true" /> Volver a pedidos
            </Button>
          </div>
          <DeliveryOrderManagementPage client={api} />
        </>
      );
    case 'routes':
      return <DispatchPlanningPage client={api} />;
    case 'control-tower':
      return <ControlTowerPage client={api} />;
    case 'drivers':
      return <DriverManagementPage client={api} canBindAccounts={session.user.role === 'ADMIN'} />;
    case 'vehicles':
      return <VehicleManagementPage client={api} />;
    case 'evidence':
      return <EvidenceWorkspace client={api} />;
  }
}
