import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRight, Eye, Package, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
import { countLabel, formatDateTime } from '../lib/format.js';
import { ORDER_STATUS_FILTER, TIME_WINDOW_FILTER } from './orders/orderFilters.js';
import { OrderDetailSheet } from './orders/OrderDetailSheet.js';

type OrdersClient = Pick<ApiClient, 'listDeliveryOrders' | 'listDeliveryOrderStatusHistory'>;

export function OrdersPage({ client, selectedCode, onSelectOrder, onManage }: {
  readonly client: OrdersClient;
  readonly selectedCode: string | null;
  readonly onSelectOrder: (code: string | null) => void;
  readonly onManage: () => void;
}) {
  const [orders, setOrders] = useState<readonly DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrders(await client.listDeliveryOrders());
    } catch {
      setError('No se pudieron cargar los pedidos. Revisa la conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  const selected = orders.find((order) => order.publicCode === selectedCode) ?? null;
  const countOf = (status: DeliveryOrder['status']) => orders.filter((order) => order.status === status).length;
  const returned = countOf('returned');

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
      filterFn: 'arrIncludesSome',
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
      filterFn: 'arrIncludesSome',
      meta: { title: 'Franja', className: 'hidden md:table-cell' },
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => <SortableHeader column={column} title="Creado" />,
      enableGlobalFilter: false,
      meta: { title: 'Creado', className: 'hidden lg:table-cell' },
      cell: ({ row }) => <span className="text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>,
    },
    {
      id: 'actions',
      enableHiding: false,
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

      <PageHeader title="Pedidos" titleId="orders-page-title" description={orders.length > 0 ? `${countOf('in_transit')} en reparto · ${countLabel(countOf('delivered'), 'entregado', 'entregados')} · ${countLabel(returned, 'devuelto', 'devueltos')}, de ${countLabel(orders.length, 'pedido', 'pedidos')}.` : 'Consulta el estado de cada pedido y abre su detalle de entrega.'}>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>{loading ? 'Actualizando…' : 'Actualizar'}</Button>
        <Button onClick={onManage}>Gestionar pedidos <ArrowRight data-icon="inline-end" aria-hidden="true" /></Button>
      </PageHeader>

      {error !== null && (
        <ErrorNotice action={<Button variant="outline" className="mt-2" onClick={() => void load()}>Reintentar</Button>}>{error}</ErrorNotice>
      )}

      {orders.length === 0 && loading && <LoadingRows label="Cargando pedidos…" />}
      {orders.length === 0 && !loading && error === null && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Package aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>Sin pedidos registrados</EmptyTitle>
            <EmptyDescription>Cuando se registre un pedido aparecerá aquí con su detalle de entrega.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button onClick={onManage}>Registrar pedidos</Button></EmptyContent>
        </Empty>
      )}

      {orders.length > 0 && (
        <>
          <DataTable label="Lista de pedidos" columns={columns} data={orders} searchPlaceholder="Buscar código, destinatario o distrito"
            filters={[ORDER_STATUS_FILTER, TIME_WINDOW_FILTER]} onRowClick={(order) => onSelectOrder(order.publicCode)} />
        </>
      )}

      <OrderDetailSheet client={client} order={selected} onClose={() => onSelectOrder(null)} />
    </section>
  );
}
