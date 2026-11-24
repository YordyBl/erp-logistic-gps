import type { UserAccount, UserRole } from '../../api/client.js';

/** Estado visible: una cuenta activa que nunca ingresó queda «Sin primer ingreso». */
export type AccessStatus = 'active' | 'pending' | 'disabled';

export const ACCESS_STATUS_LABELS: Record<AccessStatus, string> = {
  active: 'Activo',
  pending: 'Sin primer ingreso',
  disabled: 'Desactivado',
};

export function accessStatus(user: Pick<UserAccount, 'status' | 'lastLoginAt'>): AccessStatus {
  if (user.status === 'disabled') return 'disabled';
  return user.lastLoginAt === null ? 'pending' : 'active';
}

/** «Nombres Paterno Materno»; nulo si la cuenta es anterior a los nombres. */
export function userFullName(user: Pick<UserAccount, 'firstName' | 'paternalSurname' | 'maternalSurname'>): string | null {
  if (user.firstName === null || user.paternalSurname === null) return null;
  return [user.firstName, user.paternalSurname, user.maternalSurname].filter((part) => part !== null && part !== '').join(' ');
}

/** Singular y plural de cada rol para la línea de cifras: «2 administradores». */
export const ROLE_COUNT_NAMES: Record<UserRole, readonly [string, string]> = {
  ADMIN: ['administrador', 'administradores'],
  DISPATCHER: ['operador', 'operadores'],
  DRIVER: ['conductor', 'conductores'],
};
