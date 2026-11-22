import { Ban, CalendarClock, Check, Inbox, Truck, Undo2, UserCheck, type LucideIcon } from 'lucide-react';

import type { DeliveryOrderStatus } from '../api/client.js';
import { ORDER_STATUS_LABELS } from '../delivery/orderStatus.js';
import { STATUS_BADGES } from '../management/dashboard/orderStatus.js';
import { Badge } from './ui/badge.js';

export const ORDER_STATUS_ICONS: Record<DeliveryOrderStatus, LucideIcon> = {
  created: Inbox,
  planned: CalendarClock,
  assigned: UserCheck,
  in_transit: Truck,
  delivered: Check,
  returned: Undo2,
  cancelled: Ban,
};

export function OrderStatusBadge({ status }: { readonly status: DeliveryOrderStatus }) {
  const Icon = ORDER_STATUS_ICONS[status];
  return <Badge variant={STATUS_BADGES[status]}>{ORDER_STATUS_LABELS[status]}<Icon data-icon="inline-end" aria-hidden="true" /></Badge>;
}
