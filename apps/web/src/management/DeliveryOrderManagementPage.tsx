import type { ColumnDef } from '@tanstack/react-table';
import { Ban, Eye, FileSpreadsheet, Package, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ApiClient, Customer, DeliveryOrder } from '../api/client.js';
import { RowActions, SortableHeader } from '../components/data-table/columnHelpers.js';
import { DataTable } from '../components/data-table/DataTable.js';
import { RegistrationDialog } from '../components/RegistrationDialog.js';
import { ErrorNotice, LoadingRows, SuccessNotice } from '../components/Notices.js';
import { OrderStatusBadge } from '../components/OrderStatusBadge.js';
import { PageHeader } from '../components/PageHeader.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenuItem, DropdownMenuSeparator } from '../components/ui/dropdown-menu.js';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { OrderCreateSheet } from './orders/OrderCreateForm.js';
import { OrderDetailSheet } from './orders/OrderDetailSheet.js';
import { ORDER_STATUS_FILTER, TIME_WINDOW_FILTER } from './orders/orderFilters.js';
import { OrderImportSheet } from './orders/OrderImportCard.js';

type OrderClient = Pick<ApiClient, 'listCustomers' | 'listDeliveryOrders' | 'createDeliveryOrder' | 'resolveGoogleMapsLink' | 'cancelDeliveryOrder' | 'listDeliveryOrderStatusHistory' | 'importDeliveryOrders' | 'downloadDeliveryOrderImportTemplate'>;

export function DeliveryOrderManagementPage({ client }: { readonly client: OrderClient }) {
  const [customers, setCustomers] = useState<readonly Customer[]>([]);
  const [orders, setOrders] = useState<readonly DeliveryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [registered, setRegistered] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [loadedCustomers, loadedOrders] = await Promise.all([
        client.listCustomers(), client.listDeliveryOrders(),
      ]);
      setCustomers(loadedCustomers);
      setOrders(loadedOrders);
    } catch {
      setLoadError('No se pudieron cargar los pedidos y clientes. Revisa la conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void loadData(); }, [loadData]);

  const cancelOrder = useCallback(async (order: DeliveryOrder) => {
    if (!window.confirm(`¿Cancelar el pedido ${order.publicCode}? Esta acción no se puede deshacer.`)) return;
    setActionError(null);
    setNotice(null);
    try {
      const updated = await client.cancelDeliveryOrder(order.id);
      setOrders((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice(`Pedido ${order.publicCode} cancelado.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? `No se pudo cancelar el pedido. ${cause.message}` : 'No se pudo cancelar el pedido. Inténtalo de nuevo.');
    }
  }, [client]);

  function openCreate() {
    setNotice(null);
    setCreateOpen(true);
  }

  const activeCustomers = customers.filter((customer) => customer.status === 'active');
  const customerNames = useMemo(() => new Map(customers.map((customer) => [customer.id, customer.name])), [customers]);
  const detailOrder = orders.find((order) => order.id === detailOrderId) ?? null;

  const columns = useMemo<readonly ColumnDef<DeliveryOrder, unknown>[]>(() => [
    {
      accessorKey: 'publicCode',
      header: ({ column }) => <SortableHeader column={column} title="Pedido" />,
      enableHiding: false,
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-medium tabular-nums">{row.original.publicCode}</span>
          <span className="text-xs text-muted-foreground">Franja {row.original.timeWindow}</span>
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Estado',
      filterFn: 'arrIncludesSome',
      meta: { title: 'Estado' },
      cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
    },
    {
      id: 'customer',
      accessorFn: (order) => customerNames.get(order.customerId) ?? 'Cliente no disponible',
      header: ({ column }) => <SortableHeader column={column} title="Cliente" />,
      meta: { title: 'Cliente', className: 'min-w-32 whitespace-normal' },
    },
    {
      id: 'recipient',
      accessorFn: (order) => `${order.recipient.name} · ${order.recipient.phone}`,
      header: 'Destinatario',
      meta: { title: 'Destinatario', className: 'min-w-32 whitespace-normal' },
    },
    {
      id: 'address',
      accessorFn: (order) => `${order.deliveryAddress.addressLine}, ${order.deliveryAddress.district}`,
      header: 'Dirección',
      meta: { title: 'Dirección', className: 'min-w-32 whitespace-normal' },
    },
    {
      id: 'packages',
      accessorFn: (order) => order.packages.length,
      header: ({ column }) => <SortableHeader column={column} title="Bultos" />,
      enableGlobalFilter: false,
      meta: { title: 'Bultos' },
      cell: ({ row }) => `${row.original.packages.length} ${row.original.packages.length === 1 ? 'bulto' : 'bultos'}`,
    },
    { accessorKey: 'timeWindow', header: 'Franja', filterFn: 'arrIncludesSome', enableGlobalFilter: false, meta: { className: 'hidden' } },
    {
      id: 'actions',
      enableHiding: false,
      cell: ({ row }) => (
        <RowActions label={`Acciones de ${row.original.publicCode}`}>
          <DropdownMenuItem onSelect={() => setDetailOrderId(row.original.id)}><Eye aria-hidden="true" /> Ver detalle</DropdownMenuItem>
          {canCancel(row.original.status) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void cancelOrder(row.original)}><Ban aria-hidden="true" /> Cancelar pedido</DropdownMenuItem>
            </>
          )}
        </RowActions>
      ),
    },
  ], [cancelOrder, customerNames]);

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Pedidos de entrega" description="Registra pedidos vinculados a un cliente activo y consulta su estado actual.">
        <Button variant="outline" onClick={() => setImportOpen(true)}><FileSpreadsheet data-icon="inline-start" aria-hidden="true" /> Importar pedidos</Button>
        <Button onClick={openCreate}><Plus data-icon="inline-start" aria-hidden="true" /> Nuevo pedido</Button>
      </PageHeader>

      {actionError !== null && <ErrorNotice>{actionError}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      <RegistrationDialog title="Pedido registrado" message={registered} onClose={() => setRegistered(null)} />

      <div className="flex flex-col gap-4">
        {loading && <LoadingRows label="Cargando pedidos y clientes" />}
        {!loading && loadError !== null && (
          <ErrorNotice action={<Button variant="outline" className="mt-2" onClick={() => void loadData()}>Reintentar</Button>}>{loadError}</ErrorNotice>
        )}
        {!loading && loadError === null && orders.length === 0 && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Package aria-hidden="true" /></EmptyMedia>
              <EmptyTitle>Aún no hay pedidos</EmptyTitle>
              <EmptyDescription>Registra el primero o importa varios desde un archivo Excel.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent><Button onClick={openCreate}>Registrar el primero</Button></EmptyContent>
          </Empty>
        )}
        {!loading && loadError === null && orders.length > 0 && (
          <DataTable label="Pedidos registrados" columns={columns} data={orders} searchPlaceholder="Buscar pedido, cliente o dirección"
            filters={[ORDER_STATUS_FILTER, TIME_WINDOW_FILTER]} onRowClick={(order) => setDetailOrderId(order.id)} />
        )}
      </div>

      <OrderCreateSheet client={client} open={createOpen} onOpenChange={setCreateOpen} activeCustomers={activeCustomers}
        showNoCustomers={activeCustomers.length === 0 && !loading && loadError === null}
        onCreated={(created) => {
          setOrders((current) => [created, ...current.filter((order) => order.id !== created.id)]);
          setRegistered(`El pedido ${created.publicCode} se registró correctamente.`);
        }} />

      <OrderImportSheet client={client} open={importOpen} onOpenChange={setImportOpen}
        onImported={(imported) => setOrders((current) => [
          ...imported,
          ...current.filter((order) => !imported.some((created) => created.id === order.id)),
        ])} />

      <OrderDetailSheet client={client} order={detailOrder} onClose={() => setDetailOrderId(null)}
        customerName={detailOrder === null ? undefined : customerNames.get(detailOrder.customerId)} />
    </section>
  );
}

function canCancel(status: DeliveryOrder['status']): boolean {
  return status === 'created' || status === 'planned' || status === 'assigned';
}
