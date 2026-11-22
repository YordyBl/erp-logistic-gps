import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRight, Eye, Package, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { ApiClient, DeliveryOrder } from '../api/client.js';
import { AnnouncementBanner } from '../components/AnnouncementBanner.js';
import { RowActions, SortableHeader } from '../components/data-table/columnHelpers.js';
import { DataTable } from '../components/data-table/DataTable.js';
import { ErrorNotice, LoadingRows } from '../components/Notices.js';
import { OrderStatusBadge } from '../components/OrderStatusBadge.js';
import { PageHeader } from '../components/PageHeader.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenuItem } from '../components/ui/dropdown-menu.js';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { useServerTable } from '../hooks/use-server-table.js';
import { countLabel, formatDateTime } from '../lib/format.js';
import { ORDER_FILTER_PARAMS, ORDER_SORT_FIELDS, ORDER_STATUS_FILTER, TIME_WINDOW_FILTER } from './orders/orderFilters.js';
import { OrderDetailSheet } from './orders/OrderDetailSheet.js';

type OrdersClient = Pick<ApiClient, 'listDeliveryOrdersPage' | 'findOrderByPublicCode' | 'listDeliveryOrderStatusHistory'>;

export function OrdersPage({ client, selectedCode, onSelectOrder, onManage }: {
  readonly client: OrdersClient;
  readonly selectedCode: string | null;
  readonly onSelectOrder: (code: string | null) => void;
  readonly onManage: () => void;
}) {
  const table = useServerTable<DeliveryOrder>(
    (params, signal) => client.listDeliveryOrdersPage(params, signal),
    { sortFields: ORDER_SORT_FIELDS, filterParams: ORDER_FILTER_PARAMS },
  );
  const { rows, meta, loading, reload } = table;
  const error = table.error === null ? null : 'No se pudieron cargar los pedidos. Revisa la conexión e inténtalo de nuevo.';

  // El pedido abierto por enlace puede no estar en la página visible: se pide por su código.
  const inPage = rows.find((order) => order.publicCode === selectedCode) ?? null;
  const [fetched, setFetched] = useState<DeliveryOrder | null>(null);
  useEffect(() => {
    if (selectedCode === null || inPage !== null) return;
    let cancelled = false;
    client.findOrderByPublicCode(selectedCode).then((order) => {
      if (!cancelled) setFetched(order);
    }, () => {
      // Un código desconocido o de otra organización simplemente no abre la ficha.
      if (!cancelled) setFetched(null);
    });
    return () => { cancelled = true; };
  }, [client, inPage, selectedCode]);
  const selected = inPage ?? (fetched?.publicCode === selectedCode ? fetched : null);

  // Conteos del servidor: aplican la búsqueda y la franja, pero no el filtro de estado.
  const statusCounts = meta?.counts?.status ?? {};
  const countOf = (status: DeliveryOrder['status']) => statusCounts[status] ?? 0;
  const returned = countOf('returned');
  const totalOrders = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  const hasCriteria = table.state.globalFilter.trim() !== '' || table.state.columnFilters.length > 0;
  const isEmpty = meta !== null && meta.total === 0 && !hasCriteria;

  const columns = useMemo<readonly ColumnDef<DeliveryOrder, unknown>[]>(() => [
    {
      accessorKey: 'publicCode',
      header: ({ column }) => <SortableHeader column={column} title="Código" />,
      enableHiding: false,
      cell: ({ row }) => <span className="font-medium tabular-nums">{row.original.publicCode}</span>,
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      enableSorting: false,
      meta: { title: 'Estado' },
      cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
    },
    {
      id: 'recipient',
      accessorFn: (order) => order.recipient.name,
      header: ({ column }) => <SortableHeader column={column} title="Destinatario" />,
      meta: { title: 'Destinatario', className: 'hidden md:table-cell' },
    },
    {
      id: 'district',
      accessorFn: (order) => order.deliveryAddress.district,
      header: ({ column }) => <SortableHeader column={column} title="Distrito" />,
      meta: { title: 'Distrito', className: 'hidden md:table-cell' },
    },
    {
      accessorKey: 'timeWindow',
      header: 'Franja',
      enableSorting: false,
      meta: { title: 'Franja', className: 'hidden md:table-cell' },
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => <SortableHeader column={column} title="Creado" />,
      meta: { title: 'Creado', className: 'hidden lg:table-cell' },
      cell: ({ row }) => <span className="text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
    },
    {
      id: 'actions',
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => (
        <RowActions label={`Acciones de ${row.original.publicCode}`}>
          <DropdownMenuItem onSelect={() => onSelectOrder(row.original.publicCode)}><Eye aria-hidden="true" /> Ver detalle</DropdownMenuItem>
        </RowActions>
      ),
    },
  ], [onSelectOrder]);

  return (
    <section className="flex flex-col gap-6" aria-labelledby="orders-page-title">
      {returned > 0 && (
        <AnnouncementBanner storageKey="banner-pedidos-devueltos" icon={Undo2}>
          {returned === 1 ? 'Hay 1 pedido devuelto' : `Hay ${returned.toLocaleString('es-PE')} pedidos devueltos`} esperando reprogramación en Despacho.
        </AnnouncementBanner>
      )}

      <PageHeader title="Pedidos" titleId="orders-page-title" description={totalOrders > 0 ? `${countOf('in_transit')} en reparto · ${countLabel(countOf('delivered'), 'entregado', 'entregados')} · ${countLabel(returned, 'devuelto', 'devueltos')}, de ${countLabel(totalOrders, 'pedido', 'pedidos')}.` : 'Consulta el estado de cada pedido y abre su detalle de entrega.'}>
        <Button variant="outline" onClick={reload} disabled={loading}>{loading ? 'Actualizando…' : 'Actualizar'}</Button>
        <Button onClick={onManage}>Gestionar pedidos <ArrowRight data-icon="inline-end" aria-hidden="true" /></Button>
      </PageHeader>

      {error !== null && (
        <ErrorNotice action={<Button variant="outline" className="mt-2" onClick={reload}>Reintentar</Button>}>{error}</ErrorNotice>
      )}

      {meta === null && loading && <LoadingRows label="Cargando pedidos…" />}
      {isEmpty && !loading && error === null && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Package aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>Sin pedidos registrados</EmptyTitle>
            <EmptyDescription>Cuando se registre un pedido aparecerá aquí con su detalle de entrega.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button onClick={onManage}>Registrar pedidos</Button></EmptyContent>
        </Empty>
      )}

      {meta !== null && !isEmpty && (
        <DataTable label="Lista de pedidos" columns={columns} data={rows} server={table.server}
          searchPlaceholder="Buscar código, destinatario, teléfono, dirección o distrito"
          filters={[ORDER_STATUS_FILTER, TIME_WINDOW_FILTER]} onRowClick={(order) => onSelectOrder(order.publicCode)} />
      )}

      <OrderDetailSheet client={client} order={selected} onClose={() => onSelectOrder(null)} />
    </section>
  );
}
