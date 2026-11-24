import type { UserRole } from '../../api/client.js';

export interface RolePermission {
  readonly label: string;
  readonly roles: readonly UserRole[];
}

/**
 * Lo que la API permite a cada rol. Sale de los `requireRole` de `apps/api/src/http/routes`
 * (ADR-003): si una ruta cambia de rol, esta tabla cambia con ella.
 */
export const ROLE_PERMISSIONS: readonly RolePermission[] = [
  { label: 'Ver resumen, torre de control y reportes', roles: ['ADMIN', 'DISPATCHER'] },
  { label: 'Registrar clientes, crear e importar pedidos', roles: ['ADMIN', 'DISPATCHER'] },
  { label: 'Planificar y reasignar rutas', roles: ['ADMIN', 'DISPATCHER'] },
  { label: 'Registrar conductores y vehículos', roles: ['ADMIN', 'DISPATCHER'] },
  { label: 'Revisar evidencias de entrega', roles: ['ADMIN', 'DISPATCHER'] },
  { label: 'Vincular cuentas de conductor', roles: ['ADMIN'] },
  { label: 'Crear usuarios, cambiar roles y contraseñas', roles: ['ADMIN'] },
  { label: 'Ver su ruta, registrar entregas, incidencias y fotos', roles: ['DRIVER'] },
];

export const PERMISSION_ROLES: readonly UserRole[] = ['ADMIN', 'DISPATCHER', 'DRIVER'];
