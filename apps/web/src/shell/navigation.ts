import { Building2, Camera, IdCard, LayoutDashboard, Package, RadioTower, Route, Truck, type LucideIcon } from 'lucide-react';

import type { UserRole } from '../api/client.js';

export type OperatorView = 'dashboard' | 'evidence' | 'customers' | 'orders' | 'orders-manage' | 'drivers' | 'vehicles' | 'routes' | 'control-tower';

/** Views reachable from the sidebar; `orders-manage` is opened from inside Pedidos. */
export type NavView = Exclude<OperatorView, 'orders-manage'>;

export interface NavItem {
  readonly view: NavView;
  readonly label: string;
  readonly icon: LucideIcon;
}

/**
 * Pedidos is a plain link: the order list (with search, filters and detail)
 * lives in its own view, so the sidebar never loads every order.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { view: 'dashboard', label: 'Resumen', icon: LayoutDashboard },
  { view: 'control-tower', label: 'Torre de control', icon: RadioTower },
  { view: 'orders', label: 'Pedidos', icon: Package },
  { view: 'routes', label: 'Despacho', icon: Route },
  { view: 'drivers', label: 'Conductores', icon: IdCard },
  { view: 'vehicles', label: 'Vehículos', icon: Truck },
  { view: 'customers', label: 'Clientes', icon: Building2 },
  { view: 'evidence', label: 'Evidencias', icon: Camera },
];

/** The Pedidos item stays highlighted while managing orders. */
export function isNavItemActive(item: NavView, activeView: OperatorView): boolean {
  return item === activeView || (item === 'orders' && activeView === 'orders-manage');
}

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administración',
  DISPATCHER: 'Operador',
  DRIVER: 'Conductor',
};

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role];
}

/** Nombre para saludar: la API solo expone el correo de la cuenta. */
export function greetingName(email: string): string {
  return email.split('@')[0] ?? email;
}
