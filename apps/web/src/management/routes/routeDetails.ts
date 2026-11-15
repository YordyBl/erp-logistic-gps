import type { DeliveryOrder, DispatchRoute, Driver, Vehicle } from '../../api/client.js';

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

/** Ids de los pedidos de todas las paradas de las rutas dadas. */
export function routeOrderIds(routes: readonly Pick<DispatchRoute, 'stops'>[]): readonly string[] {
  return routes.flatMap((route) => route.stops.flatMap((stop) => stop.orderIds));
}
