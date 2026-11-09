import { Building2, Camera, IdCard, LayoutDashboard, RadioTower, Route, Truck, type LucideIcon } from 'lucide-react';

import type { UserRole } from '../api/client.js';

export type OperatorView = 'dashboard' | 'evidence' | 'customers' | 'orders' | 'orders-manage' | 'drivers' | 'vehicles' | 'routes' | 'control-tower';

export type SimpleNavView = Exclude<OperatorView, 'orders' | 'orders-manage'>;

export interface NavItem {
  readonly view: SimpleNavView;
  readonly label: string;
  readonly icon: LucideIcon;
}

export const NAV_BEFORE_ORDERS: readonly NavItem[] = [
  { view: 'dashboard', label: 'Resumen', icon: LayoutDashboard },
  { view: 'control-tower', label: 'Torre de control', icon: RadioTower },
];

export const NAV_AFTER_ORDERS: readonly NavItem[] = [
  { view: 'routes', label: 'Despacho', icon: Route },
  { view: 'drivers', label: 'Conductores', icon: IdCard },
  { view: 'vehicles', label: 'Vehículos', icon: Truck },
  { view: 'customers', label: 'Clientes', icon: Building2 },
  { view: 'evidence', label: 'Evidencias', icon: Camera },
];

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
