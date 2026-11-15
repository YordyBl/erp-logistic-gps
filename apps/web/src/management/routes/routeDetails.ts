import type { DeliveryOrder, DispatchRoute, Driver, Page, PageParams, Vehicle } from '../../api/client.js';

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

/** Página máxima del servidor: cada petición por `ids` pide como mucho estas filas. */
export const IDS_CHUNK_SIZE = 100;

/**
 * Trae por id, en lotes de {@link IDS_CHUNK_SIZE}, las filas que otra pantalla necesita (por ejemplo, los
 * pedidos de las rutas visibles). Ignora ids repetidos; los de otra organización simplemente no llegan.
 */
export async function fetchByIds<T>(
  fetchPage: (params: PageParams, signal?: AbortSignal) => Promise<Page<T>>,
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<readonly T[]> {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += IDS_CHUNK_SIZE) {
    chunks.push(unique.slice(start, start + IDS_CHUNK_SIZE));
  }
  const pages = await Promise.all(chunks.map((chunk) => fetchPage({ ids: chunk, pageSize: IDS_CHUNK_SIZE }, signal)));
  return pages.flatMap((page) => page.data);
}

/** Ids de los pedidos de todas las paradas de las rutas dadas. */
export function routeOrderIds(routes: readonly Pick<DispatchRoute, 'stops'>[]): readonly string[] {
  return routes.flatMap((route) => route.stops.flatMap((stop) => stop.orderIds));
}
