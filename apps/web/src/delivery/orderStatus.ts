import type { ComponentProps } from 'react';

import type { DeliveryOrderStatus, DeliveryRoute } from '../api/client.js';
import type { Badge } from '../components/ui/badge.js';

/** Nombre único de cada estado de pedido en toda la aplicación. */
export const ORDER_STATUS_LABELS: Record<DeliveryOrderStatus, string> = {
  created: 'Creado',
  planned: 'Planificado',
  assigned: 'Asignado',
  in_transit: 'En reparto',
  delivered: 'Entregado',
  returned: 'Devuelto',
  cancelled: 'Cancelado',
};

export const ROUTE_STATUS_LABELS: Record<DeliveryRoute['status'], string> = {
  planned: 'Planificada',
  in_progress: 'En curso',
  completed: 'Completada',
};

export const ROUTE_BADGES: Record<DeliveryRoute['status'], ComponentProps<typeof Badge>['variant']> = {
  planned: 'outline',
  in_progress: 'warning',
  completed: 'success',
};
