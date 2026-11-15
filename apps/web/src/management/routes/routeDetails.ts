import type { ApiClient, DeliveryOrder, DispatchRoute, Driver, Vehicle } from '../../api/client.js';

export type RouteDetailsClient = Partial<Pick<ApiClient, 'listDispatchRoutes' | 'listDeliveryOrders' | 'listDrivers' | 'listVehicles'>>;

/** Lo mínimo de una ruta para resolver su tripulación y su avance. */
export type RouteDetailsRoute = Pick<DispatchRoute, 'id' | 'driverId' | 'vehicleId' | 'status'> & {
  readonly stops: readonly Pick<DispatchRoute['stops'][number], 'id' | 'orderIds'>[];
};

/**
 * Datos que completan el seguimiento de una ruta. Si fallan, la pantalla sigue funcionando sin ellos.
 * Los tipos son mínimos para que la Torre de control los arme desde su snapshot y los catálogos.
 */
export interface RouteDetails<
  TRoute extends RouteDetailsRoute = RouteDetailsRoute,
  TOrder extends Pick<DeliveryOrder, 'id' | 'publicCode' | 'status'> = Pick<DeliveryOrder, 'id' | 'publicCode' | 'status'>,
> {
  readonly routes: readonly TRoute[];
  readonly orders: readonly TOrder[];
  readonly drivers: readonly Pick<Driver, 'id' | 'fullName'>[];
  readonly vehicles: readonly Pick<Vehicle, 'id' | 'plate'>[];
}

/** Los catálogos completos, tal como los descarga {@link loadRouteDetails}. */
export type FullRouteDetails = RouteDetails<DispatchRoute, DeliveryOrder> & {
  readonly drivers: readonly Driver[];
  readonly vehicles: readonly Vehicle[];
};

export const NO_ROUTE_DETAILS: FullRouteDetails = { routes: [], orders: [], drivers: [], vehicles: [] };

export async function loadRouteDetails(client: RouteDetailsClient): Promise<FullRouteDetails> {
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
