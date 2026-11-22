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

/** The ERP lives under `/app`; `/` is reserved for the public site. */
export const APP_BASE = '/app';

/** URL segment of each view under `/app`. The dashboard is the index. */
const VIEW_SEGMENTS: Record<OperatorView, string> = {
  dashboard: '',
  'control-tower': 'torre-control',
  orders: 'pedidos',
  'orders-manage': 'pedidos/gestionar',
  routes: 'despacho',
  drivers: 'conductores',
  vehicles: 'vehiculos',
  customers: 'clientes',
  evidence: 'evidencias',
};

/** Relative route path of a view, for `<Route path>`. */
export function viewSegment(view: OperatorView): string {
  return VIEW_SEGMENTS[view];
}

/** Absolute URL of a view. */
export function viewPath(view: OperatorView): string {
  const segment = VIEW_SEGMENTS[view];
  return segment === '' ? APP_BASE : `${APP_BASE}/${segment}`;
}

/** Absolute URL of one order's detail inside Pedidos. */
export function orderPath(publicCode: string): string {
  return `${viewPath('orders')}/${encodeURIComponent(publicCode)}`;
}

/** The view a URL belongs to; unknown paths fall back to the dashboard. */
export function viewFromPath(pathname: string): OperatorView {
  const rest = pathname.replace(/\/+$/, '').slice(APP_BASE.length).replace(/^\//, '');
  if (rest === viewSegment('orders-manage')) return 'orders-manage';
  const first = rest.split('/')[0] ?? '';
  const match = (Object.keys(VIEW_SEGMENTS) as OperatorView[])
    .find((view) => view !== 'orders-manage' && VIEW_SEGMENTS[view] === first);
  return match ?? 'dashboard';
}

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
