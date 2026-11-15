import type { ColumnDef } from '@tanstack/react-table';
import { Ban, Eye, FileSpreadsheet, Package, Pencil, Plus } from 'lucide-react';
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
import { useServerTable } from '../hooks/use-server-table.js';
import { OrderCreateSheet, OrderEditSheet } from './orders/OrderCreateForm.js';
import { OrderDetailSheet } from './orders/OrderDetailSheet.js';
import { ORDER_FILTER_PARAMS, ORDER_SORT_FIELDS, ORDER_STATUS_FILTER, TIME_WINDOW_FILTER } from './orders/orderFilters.js';
import { OrderImportSheet } from './orders/OrderImportCard.js';

type OrderClient = Pick<ApiClient, 'listCustomers' | 'listDeliveryOrdersPage' | 'createDeliveryOrder' | 'editDeliveryOrder' | 'resolveGoogleMapsLink' | 'cancelDeliveryOrder' | 'listDeliveryOrderStatusHistory' | 'importDeliveryOrders' | 'downloadDeliveryOrderImportTemplate'>;

export function DeliveryOrderManagementPage({ client }: { readonly client: OrderClient }) {
  const table = useServerTable<DeliveryOrder>(
    (params, signal) => client.listDeliveryOrdersPage(params, signal),
    { sortFields: ORDER_SORT_FIELDS, filterParams: ORDER_FILTER_PARAMS },
  );
  const { rows, meta, reload } = table;
  // Catálogo completo de clientes para los nombres y el formulario de alta (se pagina en la fase 4).
  const [customers, setCustomers] = useState<readonly Customer[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [customersError, setCustomersError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [registered, setRegistered] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // Se guarda el pedido abierto: si deja de estar en la página (otra búsqueda, otra página) la ficha sigue.
  const [detailSnapshot, setDetailSnapshot] = useState<DeliveryOrder | null>(null);
  const [editingSnapshot, setEditingSnapshot] = useState<DeliveryOrder | null>(null);

  const loadCustomers = useCallback(async () => {
    setCustomersLoading(true);
    setCustomersError(false);
    try {
      setCustomers(await client.listCustomers());
    } catch {
      setCustomersError(true);
    } finally {
      setCustomersLoading(false);
    }
  }, [client]);

  useEffect(() => { void loadCustomers(); }, [loadCustomers]);

  const retry = useCallback(() => {
    reload();
    if (customersError) void loadCustomers();
  }, [customersError, loadCustomers, reload]);

  const cancelOrder = useCallback(async (order: DeliveryOrder) => {
    if (!window.confirm(`¿Cancelar el pedido ${order.publicCode}? Esta acción no se puede deshacer.`)) return;
    setActionError(null);
    setNotice(null);
    try {
      const updated = await client.cancelDeliveryOrder(order.id);
      setDetailSnapshot((current) => current?.id === updated.id ? updated : current);
      reload();
      setNotice(`Pedido ${order.publicCode} cancelado.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? `No se pudo cancelar el pedido. ${cause.message}` : 'No se pudo cancelar el pedido. Inténtalo de nuevo.');
    }
  }, [client, reload]);

  function openCreate() {
    setNotice(null);
    setCreateOpen(true);
  }

  const activeCustomers = customers.filter((customer) => customer.status === 'active');
  const customerNames = useMemo(() => new Map(customers.map((customer) => [customer.id, customer.name])), [customers]);
  // La fila de la página actual es la versión más reciente; si no está, se usa la que se abrió.
  const fresh = (snapshot: DeliveryOrder | null) =>
    snapshot === null ? null : rows.find((order) => order.id === snapshot.id) ?? snapshot;
  const detailOrder = fresh(detailSnapshot);
  const editingOrder = fresh(editingSnapshot);

  const startEdit = useCallback((order: DeliveryOrder) => {
    setActionError(null);
    setNotice(null);
    setDetailSnapshot(null);
    setEditingSnapshot(order);
  }, []);

  const loadError = table.error !== null || customersError
    ? 'No se pudieron cargar los pedidos y clientes. Revisa la conexión e inténtalo de nuevo.'
    : null;
  const hasCriteria = table.state.globalFilter.trim() !== '' || table.state.columnFilters.length > 0;
  const isEmpty = meta !== null && meta.total === 0 && !hasCriteria;

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
      enableSorting: false,
      meta: { title: 'Estado' },
      cell: ({ row }) => <OrderStatusBadge status={row.original.status} />,
    },
    {
      id: 'customer',
      accessorFn: (order) => customerNames.get(order.customerId) ?? (customersLoading ? '' : 'Cliente no disponible'),
      header: 'Cliente',
      enableSorting: false,
      meta: { title: 'Cliente', className: 'min-w-32 whitespace-normal' },
    },
    {
      id: 'recipient',
      accessorFn: (order) => `${order.recipient.name} · ${order.recipient.phone}`,
      header: ({ column }) => <SortableHeader column={column} title="Destinatario" />,
      meta: { title: 'Destinatario', className: 'min-w-32 whitespace-normal' },
    },
    {
      id: 'address',
      accessorFn: (order) => `${order.deliveryAddress.addressLine}, ${order.deliveryAddress.district}`,
      header: 'Dirección',
      enableSorting: false,
      meta: { title: 'Dirección', className: 'min-w-32 whitespace-normal' },
    },
    {
      id: 'packages',
      accessorFn: (order) => order.packages.length,
      header: 'Bultos',
      enableSorting: false,
      meta: { title: 'Bultos' },
      cell: ({ row }) => `${row.original.packages.length} ${row.original.packages.length === 1 ? 'bulto' : 'bultos'}`,
    },
    { accessorKey: 'timeWindow', header: 'Franja', enableSorting: false, meta: { className: 'hidden' } },
    {
      id: 'actions',
      enableHiding: false,
      enableSorting: false,
      cell: ({ row }) => (
        <RowActions label={`Acciones de ${row.original.publicCode}`}>
          <DropdownMenuItem onSelect={() => setDetailSnapshot(row.original)}><Eye aria-hidden="true" /> Ver detalle</DropdownMenuItem>
          {canEdit(row.original.status) && (
            <DropdownMenuItem onSelect={() => startEdit(row.original)}><Pencil aria-hidden="true" /> Editar pedido</DropdownMenuItem>
          )}
          {canCancel(row.original.status) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => void cancelOrder(row.original)}><Ban aria-hidden="true" /> Cancelar pedido</DropdownMenuItem>
            </>
          )}
        </RowActions>
      ),
    },
  ], [cancelOrder, customerNames, customersLoading, startEdit]);

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
        {meta === null && table.loading && <LoadingRows label="Cargando pedidos y clientes" />}
        {loadError !== null && !table.loading && (
          <ErrorNotice action={<Button variant="outline" className="mt-2" onClick={retry}>Reintentar</Button>}>{loadError}</ErrorNotice>
        )}
        {isEmpty && !table.loading && loadError === null && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Package aria-hidden="true" /></EmptyMedia>
              <EmptyTitle>Aún no hay pedidos</EmptyTitle>
              <EmptyDescription>Registra el primero o importa varios desde un archivo Excel.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent><Button onClick={openCreate}>Registrar el primero</Button></EmptyContent>
          </Empty>
        )}
        {meta !== null && !isEmpty && (
          <DataTable label="Pedidos registrados" columns={columns} data={rows} server={table.server}
            searchPlaceholder="Buscar pedido, destinatario, teléfono o dirección"
            filters={[ORDER_STATUS_FILTER, TIME_WINDOW_FILTER]} onRowClick={(order) => setDetailSnapshot(order)} />
        )}
      </div>

      <OrderCreateSheet client={client} open={createOpen} onOpenChange={setCreateOpen} activeCustomers={activeCustomers}
        showNoCustomers={activeCustomers.length === 0 && !customersLoading && !customersError}
        onCreated={(created) => {
          reload();
          setRegistered(`El pedido ${created.publicCode} se registró correctamente.`);
        }} />

      <OrderImportSheet client={client} open={importOpen} onOpenChange={setImportOpen}
        onImported={(imported) => { if (imported.length > 0) reload(); }} />

      <OrderDetailSheet client={client} order={detailOrder} onClose={() => setDetailSnapshot(null)}
        customerName={detailOrder === null ? undefined : customerNames.get(detailOrder.customerId)}
        {...(detailOrder !== null && canEdit(detailOrder.status) ? {
          footer: <Button type="button" onClick={() => startEdit(detailOrder)}><Pencil data-icon="inline-start" aria-hidden="true" /> Editar pedido</Button>,
        } : {})} />

      <OrderEditSheet client={client} order={editingOrder} onClose={() => setEditingSnapshot(null)}
        customerName={editingOrder === null ? undefined : customerNames.get(editingOrder.customerId)}
        onSaved={(updated) => {
          reload();
          setNotice(`Pedido ${updated.publicCode} actualizado.`);
        }} />
    </section>
  );
}

/** Details may change only before the order is planned into a route (enforced by the API too). */
function canEdit(status: DeliveryOrder['status']): boolean {
  return status === 'created';
}

function canCancel(status: DeliveryOrder['status']): boolean {
  return status === 'created' || status === 'planned' || status === 'assigned';
}
