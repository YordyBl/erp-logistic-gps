import { Route } from 'lucide-react';
import { Link } from 'react-router';

import type { AuthSession } from '../api/client.js';
import { BrandMark } from '../components/BrandMark.js';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar,
} from '../components/ui/sidebar.js';
import { isNavItemActive, NAV_GROUPS, navItemsFor, viewPath, type NavItem, type OperatorView } from './navigation.js';
import { NavUser } from './NavUser.js';

interface AppSidebarProps {
  readonly session: AuthSession;
  readonly activeView: OperatorView;
  readonly onSignOut: () => void;
}

export function AppSidebar({ session, activeView, onSignOut }: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const isDriver = session.user.role === 'DRIVER';
  const items = navItemsFor(session.user.role);

  const renderItem = ({ view, label, icon: Icon }: NavItem) => {
    const active = isNavItemActive(view, activeView);
    return (
      <SidebarMenuItem key={view}>
        <SidebarMenuButton asChild tooltip={label} isActive={active}>
          <Link to={viewPath(view)} aria-current={active ? 'page' : undefined}
            onClick={() => { if (isMobile) setOpenMobile(false); }}>
            <Icon aria-hidden="true" /> <span>{label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <BrandMark className="p-2 group-data-[collapsible=icon]:p-0" />
      </SidebarHeader>

      <SidebarContent>
        <nav aria-label="Navegación principal">
          {isDriver ? (
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive tooltip="Mi ruta">
                    <a href="#mi-ruta" aria-current="page"><Route aria-hidden="true" /> <span>Mi ruta</span></a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          ) : NAV_GROUPS.map((group) => {
            const groupItems = items.filter((item) => item.group === group.id);
            if (groupItems.length === 0) return null;
            return (
              <SidebarGroup key={group.id}>
                {/* Colapsada, la etiqueta sube sobre el último ícono del grupo anterior: no debe tapar su clic. */}
                <SidebarGroupLabel className="group-data-[collapsible=icon]:pointer-events-none">{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>{groupItems.map(renderItem)}</SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          })}
        </nav>
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={session.user} onSignOut={onSignOut} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
