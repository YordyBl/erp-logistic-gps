import { ChevronRight, Package, Route } from 'lucide-react';
import type { ReactNode } from 'react';

import type { AuthSession } from '../api/client.js';
import { BrandMark } from '../components/BrandMark.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible.js';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarRail, useSidebar,
} from '../components/ui/sidebar.js';
import { NAV_AFTER_ORDERS, NAV_BEFORE_ORDERS, type NavItem, type OperatorView, type SimpleNavView } from './navigation.js';
import { NavUser } from './NavUser.js';
import type { SidebarOrdersState } from './useSidebarOrders.js';

interface AppSidebarProps {
  readonly session: AuthSession;
  readonly activeView: OperatorView;
  readonly orders: { readonly open: boolean; readonly state: SidebarOrdersState };
  readonly selectedOrderCode: string | null;
  readonly onNavigate: (view: SimpleNavView) => void;
  readonly onToggleOrders: () => void;
  readonly onOpenOrder: (code: string) => void;
  readonly onSignOut: () => void;
}

export function AppSidebar({ session, activeView, orders, selectedOrderCode, onNavigate, onToggleOrders, onOpenOrder, onSignOut }: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const isDriver = session.user.role === 'DRIVER';
  const ordersActive = activeView === 'orders' || activeView === 'orders-manage';
  const closeOnMobile = () => { if (isMobile) setOpenMobile(false); };

  const renderItem = ({ view, label, icon: Icon }: NavItem) => (
    <SidebarMenuItem key={view}>
      <SidebarMenuButton tooltip={label} isActive={activeView === view} aria-current={activeView === view ? 'page' : undefined}
        onClick={() => { onNavigate(view); closeOnMobile(); }}>
        <Icon aria-hidden="true" /> <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <BrandMark className="p-2 group-data-[collapsible=icon]:p-0" />
      </SidebarHeader>

      <SidebarContent>
        <nav aria-label="Navegación principal">
          <SidebarGroup>
            <SidebarMenu>
              {isDriver ? (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive tooltip="Mi ruta">
                    <a href="#mi-ruta" aria-current="page"><Route aria-hidden="true" /> <span>Mi ruta</span></a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : (
                <>
                  {NAV_BEFORE_ORDERS.map(renderItem)}
                  <Collapsible asChild open={orders.open} onOpenChange={onToggleOrders} className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip="Pedidos" isActive={ordersActive} aria-current={ordersActive ? 'page' : undefined}>
                          <Package aria-hidden="true" /> <span>Pedidos</span>
                          <ChevronRight aria-hidden="true" className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          <OrdersTree state={orders.state} selectedCode={selectedOrderCode}
                            onOpen={(code) => { onOpenOrder(code); closeOnMobile(); }} />
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                  {NAV_AFTER_ORDERS.map(renderItem)}
                </>
              )}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={session.user} onSignOut={onSignOut} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function OrdersTree({ state, selectedCode, onOpen }: {
  readonly state: SidebarOrdersState;
  readonly selectedCode: string | null;
  readonly onOpen: (code: string) => void;
}) {
  if (state.status === 'error') return <TreeNote>No se pudieron cargar los pedidos.</TreeNote>;
  if (state.status !== 'ready') return <TreeNote>Cargando…</TreeNote>;
  if (state.orders.length === 0) return <TreeNote>Sin pedidos.</TreeNote>;
  return state.orders.map((order) => (
    <SidebarMenuSubItem key={order.id}>
      {/* SidebarMenuSubButton renderiza <a>; sin destino, solo un <button> es accionable con teclado. */}
      <SidebarMenuSubButton asChild isActive={selectedCode === order.publicCode}>
        <button type="button" className="w-full" aria-label={`Pedido ${order.publicCode}`}
          aria-current={selectedCode === order.publicCode ? 'true' : undefined} onClick={() => onOpen(order.publicCode)}>
          <span>{order.publicCode}</span>
        </button>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  ));
}

function TreeNote({ children }: { readonly children: ReactNode }) {
  return <li className="px-2 py-1 text-xs text-muted-foreground">{children}</li>;
}
