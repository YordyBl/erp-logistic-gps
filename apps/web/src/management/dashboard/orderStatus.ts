import type { ComponentProps } from 'react';

import type { DeliveryOrderStatus, DispatchDashboardSummary } from '../../api/client.js';
import type { Badge } from '../../components/ui/badge.js';

// Cancelado separa a Entregado (verde) de Devuelto (coral), un par confuso con daltonismo.
export const STATUS_ORDER: readonly DeliveryOrderStatus[] = [
  'created', 'planned', 'assigned', 'in_transit', 'delivered', 'cancelled', 'returned',
];

/** Color fijo por estado: filtrar o quedar en cero nunca repinta a los demás. */
export const STATUS_COLORS: Record<DeliveryOrderStatus, string> = {
  created: 'var(--status-created)',
  planned: 'var(--status-planned)',
  assigned: 'var(--status-assigned)',
  in_transit: 'var(--status-in-transit)',
  delivered: 'var(--status-delivered)',
  returned: 'var(--status-returned)',
  cancelled: 'var(--status-cancelled)',
};

export const STATUS_BADGES: Record<DeliveryOrderStatus, ComponentProps<typeof Badge>['variant']> = {
  created: 'secondary',
  planned: 'info',
  assigned: 'info',
  in_transit: 'warning',
  delivered: 'success',
  returned: 'destructive',
  cancelled: 'secondary',
};

type StatusCounts = DispatchDashboardSummary['orderStatusCounts'];

export function totalOrders(counts: StatusCounts): number {
  return STATUS_ORDER.reduce((total, status) => total + counts[status], 0);
}

/** Pedidos que aún no llegan a un estado final. */
export function openOrders(counts: StatusCounts): number {
  return counts.created + counts.planned + counts.assigned + counts.in_transit;
}

export function deliveredShare(counts: StatusCounts): number {
  const total = totalOrders(counts);
  return total === 0 ? 0 : Math.round((counts.delivered / total) * 100);
}
