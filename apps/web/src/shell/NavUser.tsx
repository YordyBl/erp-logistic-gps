import { ChevronsUpDown, LogOut } from 'lucide-react';

import type { AuthSession } from '../api/client.js';
import { Avatar, AvatarFallback } from '../components/ui/avatar.js';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '../components/ui/sidebar.js';
import { greetingName, roleLabel } from './navigation.js';

export function NavUser({ user, onSignOut }: {
  readonly user: AuthSession['user'];
  readonly onSignOut: () => void;
}) {
  const { isMobile } = useSidebar();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label="Menú de la cuenta">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">{user.email.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">Hola, {greetingName(user.email)}</span>
                <span className="truncate text-xs">{roleLabel(user.role)}</span>
              </span>
              <ChevronsUpDown className="ml-auto" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-56" side={isMobile ? 'top' : 'right'} align="end" sideOffset={4}>
            <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onSignOut}><LogOut aria-hidden="true" /> Cerrar sesión</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
