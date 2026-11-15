import type { DispatchRoute, Vehicle, VehicleRouteStats } from '../../api/client.js';

export interface VehicleStats {
  readonly routes: number;
  readonly completedRoutes: number;
  readonly stops: number;
  readonly orders: number;
  /** Día planificado (`YYYY-MM-DD`) de la ruta más reciente, o `null` si nunca salió. */
  readonly lastRouteDay: string | null;
}

export interface MonthlyRoutes {
  /** `YYYY-MM` */
  readonly month: string;
  readonly label: string;
  readonly routes: number;
}

export const EMPTY_STATS: VehicleStats = { routes: 0, completedRoutes: 0, stops: 0, orders: 0, lastRouteDay: null };

/** Los totales que el servidor agrega para un vehículo (`GET /vehicles/route-stats`), como los muestra la flota. */
export function toVehicleStats(stats: VehicleRouteStats): VehicleStats {
  return {
    routes: stats.routes, completedRoutes: stats.completed, stops: stats.stops, orders: stats.orders,
    lastRouteDay: stats.lastRouteDay,
  };
}

/** La serie mensual del servidor con la etiqueta corta del mes (`jun`, `jul`...). */
export function toMonthlyRoutes(monthly: VehicleRouteStats['monthly']): readonly MonthlyRoutes[] {
  return monthly.map(({ month, routes }) => ({
    month, routes,
    label: MONTH_LABEL.format(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1))).replace('.', ''),
  }));
}

export function countOrders(route: Pick<DispatchRoute, 'stops'>): number {
  return route.stops.reduce((total, stop) => total + stop.orderIds.length, 0);
}

export type VehicleKind = 'car' | 'moto' | 'van' | 'truck';

/** El tipo es texto libre; se elige la ilustración por palabras clave y, si no hay ninguna, un auto. */
export function vehicleKind(vehicle: Pick<Vehicle, 'type'>): VehicleKind {
  const type = vehicle.type.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (/moto|scooter|bicimoto/.test(type)) return 'moto';
  if (/camion|truck|furgon de carga/.test(type)) return 'truck';
  if (/furgon|van|camioneta|minivan|panel/.test(type)) return 'van';
  return 'car';
}

export const VEHICLE_IMAGES: Record<VehicleKind, string> = {
  car: '/vehicles/car.svg',
  moto: '/vehicles/moto.svg',
  van: '/vehicles/van.svg',
  truck: '/vehicles/truck.svg',
};

const MONTH_LABEL = new Intl.DateTimeFormat('es-PE', { month: 'short', timeZone: 'UTC' });
