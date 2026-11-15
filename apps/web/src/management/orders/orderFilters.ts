import { ORDER_STATUS_ICONS } from '../../components/OrderStatusBadge.js';
import type { DataTableFilter } from '../../components/data-table/DataTable.js';
import { ORDER_STATUS_LABELS } from '../../delivery/orderStatus.js';
import { STATUS_ORDER } from '../dashboard/orderStatus.js';

export const ORDER_STATUS_FILTER: DataTableFilter = {
  columnId: 'status',
  title: 'Estado',
  options: STATUS_ORDER.map((status) => ({ value: status, label: ORDER_STATUS_LABELS[status], icon: ORDER_STATUS_ICONS[status] })),
};

export const TIME_WINDOW_FILTER: DataTableFilter = {
  columnId: 'timeWindow',
  title: 'Franja',
  options: [{ value: 'AM', label: 'AM · Mañana' }, { value: 'PM', label: 'PM · Tarde' }],
};

/** `columnId` ordenable de las tablas de pedidos → campo de `sort` en `GET /delivery-orders`. */
export const ORDER_SORT_FIELDS: Readonly<Record<string, string>> = {
  publicCode: 'publicCode', recipient: 'recipientName', district: 'district', createdAt: 'createdAt',
};

/** `columnId` de faceta → parámetro de `GET /delivery-orders` (y clave de `meta.counts`). */
export const ORDER_FILTER_PARAMS: Readonly<Record<string, string>> = { status: 'status', timeWindow: 'timeWindow' };
