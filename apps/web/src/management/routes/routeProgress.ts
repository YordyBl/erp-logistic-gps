import type { DeliveryOrder, DispatchRoute } from '../../api/client.js';

export type StopState = 'done' | 'issue' | 'current' | 'pending';

export interface RouteProgress {
  readonly total: number;
  readonly delivered: number;
  readonly returned: number;
  /** Pedidos en estado final, entregados o no. */
  readonly closed: number;
  readonly percent: number;
  readonly stopStates: readonly StopState[];
}

const FINAL_STATUSES: readonly DeliveryOrder['status'][] = ['delivered', 'returned', 'cancelled'];

/** Calcula el avance solo con los estados reales de los pedidos de la ruta. */
export function summarizeRoute(
  route: Pick<DispatchRoute, 'status' | 'stops'>,
  orderById: ReadonlyMap<string, Pick<DeliveryOrder, 'status'>>,
): RouteProgress {
  const stopOrders = route.stops.map((stop) => stop.orderIds.flatMap((id) => {
    const order = orderById.get(id);
    return order === undefined ? [] : [order.status];
  }));
  const statuses = stopOrders.flat();
  const closed = statuses.filter((status) => FINAL_STATUSES.includes(status)).length;

  let currentAssigned = false;
  const stopStates = stopOrders.map((orders): StopState => {
    if (orders.includes('returned')) return 'issue';
    const finished = orders.length > 0 && orders.every((status) => FINAL_STATUSES.includes(status));
    if (finished || route.status === 'completed') return 'done';
    if (route.status === 'in_progress' && !currentAssigned) {
      currentAssigned = true;
      return 'current';
    }
    return 'pending';
  });

  return {
    total: statuses.length,
    delivered: statuses.filter((status) => status === 'delivered').length,
    returned: statuses.filter((status) => status === 'returned').length,
    closed,
    percent: statuses.length === 0 ? 0 : Math.round((closed / statuses.length) * 100),
    stopStates,
  };
}
