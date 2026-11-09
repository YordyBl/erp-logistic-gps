import type { DispatchRoute, Vehicle } from '../../api/client.js';

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

/** Rutas de cada vehículo, de la más reciente a la más antigua. */
export function groupRoutesByVehicle(routes: readonly DispatchRoute[]): ReadonlyMap<string, readonly DispatchRoute[]> {
  const grouped = new Map<string, DispatchRoute[]>();
  for (const route of routes) {
    const list = grouped.get(route.vehicleId);
    if (list === undefined) grouped.set(route.vehicleId, [route]);
    else list.push(route);
  }
  for (const list of grouped.values()) list.sort(compareRoutesDesc);
  return grouped;
}

export function summarizeVehicleRoutes(routes: readonly DispatchRoute[]): VehicleStats {
  if (routes.length === 0) return EMPTY_STATS;
  let completedRoutes = 0, stops = 0, orders = 0;
  let lastRouteDay = '';
  for (const route of routes) {
    if (route.status === 'completed') completedRoutes += 1;
    stops += route.stops.length;
    orders += countOrders(route);
    const day = routeDay(route);
    if (day > lastRouteDay) lastRouteDay = day;
  }
  return { routes: routes.length, completedRoutes, stops, orders, lastRouteDay };
}

export function countOrders(route: DispatchRoute): number {
  return route.stops.reduce((total, stop) => total + stop.orderIds.length, 0);
}

/** Rutas planificadas en cada uno de los últimos `months` meses, terminando en el mes de `today`. */
export function monthlyRoutes(routes: readonly DispatchRoute[], today: string, months = 6): readonly MonthlyRoutes[] {
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const counts = new Map<string, number>();
  for (const route of routes) {
    const key = routeDay(route).slice(0, 7);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (months - 1 - index), 1));
    const key = date.toISOString().slice(0, 7);
    return { month: key, label: MONTH_LABEL.format(date).replace('.', ''), routes: counts.get(key) ?? 0 };
  });
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

/** Hoy en Lima como `YYYY-MM-DD`. */
export function todayInLima(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(now);
}

const MONTH_LABEL = new Intl.DateTimeFormat('es-PE', { month: 'short', timeZone: 'UTC' });

/** La API puede devolver la fecha con hora; solo cuenta el día. */
function routeDay(route: Pick<DispatchRoute, 'plannedDate'>): string {
  return route.plannedDate.slice(0, 10);
}

function compareRoutesDesc(left: DispatchRoute, right: DispatchRoute): number {
  return routeDay(right).localeCompare(routeDay(left)) || right.publicCode.localeCompare(left.publicCode);
}
