import type { ApiClient, DeliveryOrder, DispatchRoute, Driver, Vehicle } from '../../api/client.js';

export type RouteDetailsClient = Partial<Pick<ApiClient, 'listDispatchRoutes' | 'listDeliveryOrders' | 'listDrivers' | 'listVehicles'>>;

/** Datos que completan el seguimiento de una ruta. Si fallan, la pantalla sigue funcionando sin ellos. */
export interface RouteDetails {
  readonly routes: readonly DispatchRoute[];
  readonly orders: readonly DeliveryOrder[];
  readonly drivers: readonly Driver[];
  readonly vehicles: readonly Vehicle[];
}

export const NO_ROUTE_DETAILS: RouteDetails = { routes: [], orders: [], drivers: [], vehicles: [] };

export async function loadRouteDetails(client: RouteDetailsClient): Promise<RouteDetails> {
  const [routes, orders, drivers, vehicles] = await Promise.allSettled([
    client.listDispatchRoutes?.() ?? Promise.resolve([]),
    client.listDeliveryOrders?.() ?? Promise.resolve([]),
    client.listDrivers?.() ?? Promise.resolve([]),
    client.listVehicles?.() ?? Promise.resolve([]),
  ]);
  return {
    routes: routes.status === 'fulfilled' ? routes.value : [],
    orders: orders.status === 'fulfilled' ? orders.value : [],
    drivers: drivers.status === 'fulfilled' ? drivers.value : [],
    vehicles: vehicles.status === 'fulfilled' ? vehicles.value : [],
  };
}
