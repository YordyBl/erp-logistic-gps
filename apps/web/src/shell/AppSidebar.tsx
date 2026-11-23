import { Route } from 'lucide-react';
import { Link } from 'react-router';

import type { AuthSession } from '../api/client.js';
import { BrandMark } from '../components/BrandMark.js';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarRail, useSidebar,
} from '../components/ui/sidebar.js';
import { isNavItemActive, NAV_ITEMS, viewPath, type NavItem, type OperatorView } from './navigation.js';
import { NavUser } from './NavUser.js';

interface AppSidebarProps {
  readonly session: AuthSession;
  readonly activeView: OperatorView;
  readonly onSignOut: () => void;
}

export function AppSidebar({ session, activeView, onSignOut }: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const isDriver = session.user.role === 'DRIVER';

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
          <SidebarGroup>
            <SidebarMenu>
              {isDriver ? (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive tooltip="Mi ruta">
                    <a href="#mi-ruta" aria-current="page"><Route aria-hidden="true" /> <span>Mi ruta</span></a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : NAV_ITEMS.map(renderItem)}
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
