/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chooseOption, chooseRowAction, setupUser } from '../test/ui.js';

import { ApiError, type Customer, type DeliveryOrder, type DeliveryOrderImportResult, type DeliveryOrderStatusHistory, type Page, type PageParams } from '../api/client.js';
import { DeliveryOrderManagementPage } from './DeliveryOrderManagementPage.js';

const customer: Customer = {
  id: 'customer-active', organizationId: 'org-1', publicCode: 'ACME', name: 'Acme Logística',
  contactName: 'Ana Pérez', contactEmail: 'ana@example.test', contactPhone: '999 111 222',
  status: 'active', createdAt: '2026-10-29T12:00:00.000Z',
};
const inactiveCustomer: Customer = { ...customer, id: 'customer-inactive', name: 'Cliente antiguo', status: 'inactive' };
const order: DeliveryOrder = {
  id: 'order-1', organizationId: 'org-1', customerId: customer.id, publicCode: 'LIM-2041', status: 'created',
  timeWindow: 'AM',
  recipient: { name: 'María Pérez', phone: '999 000 111' },
  deliveryAddress: { addressLine: 'Av. Arequipa 123', district: 'Lince', latitude: null, longitude: null },
  packages: [{ code: 'PKG-01', description: 'Caja mediana', weightKg: null }],
  createdAt: '2026-10-29T12:00:00.000Z', updatedAt: '2026-10-29T12:00:00.000Z',
};

/** Una página del servidor con los conteos por faceta de esas filas. */
function pageOf(orders: readonly DeliveryOrder[], total = orders.length): Page<DeliveryOrder> {
  const status: Record<string, number> = {};
  const timeWindow: Record<string, number> = { AM: 0, PM: 0 };
  for (const item of orders) {
    status[item.status] = (status[item.status] ?? 0) + 1;
    timeWindow[item.timeWindow] = (timeWindow[item.timeWindow] ?? 0) + 1;
  }
  return { data: orders, meta: { page: 1, pageSize: 10, total, counts: { status, timeWindow } } };
}

/**
 * Servidor de clientes simulado: `ids` devuelve esos clientes (de la organización); si no, filtra
 * por `status` y `q` como `GET /customers`.
 */
function customersServer(catalog: readonly Customer[] = [customer, inactiveCustomer]) {
  return vi.fn(async (params: PageParams): Promise<Page<Customer>> => {
    const ids = params.ids as readonly string[] | undefined;
    const status = typeof params.status === 'string' ? params.status.split(',') : params.status as readonly string[] | undefined;
    const q = params.q?.toLowerCase();
    const data = catalog.filter((item) => (ids === undefined || ids.includes(item.id))
      && (status === undefined || status.includes(item.status))
      && (q === undefined || `${item.name} ${item.publicCode}`.toLowerCase().includes(q)));
    return { data, meta: { page: 1, pageSize: params.pageSize ?? 20, total: data.length, counts: { status: {} } } };
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeClient(overrides: Partial<{
  listCustomersPage: (params: PageParams, signal?: AbortSignal) => Promise<Page<Customer>>;
  listDeliveryOrdersPage: (params: PageParams, signal?: AbortSignal) => Promise<Page<DeliveryOrder>>;
  createDeliveryOrder: (input: unknown) => Promise<DeliveryOrder>;
  resolveGoogleMapsLink: (url: string) => Promise<{ latitude: number; longitude: number }>;
  editDeliveryOrder: (id: string, changes: unknown) => Promise<DeliveryOrder>;
  cancelDeliveryOrder: (id: string) => Promise<DeliveryOrder>;
  listDeliveryOrderStatusHistory: (id: string) => Promise<readonly DeliveryOrderStatusHistory[]>;
  importDeliveryOrders: (file: File) => Promise<DeliveryOrderImportResult>;
  downloadDeliveryOrderImportTemplate: () => Promise<Blob>;
}> = {}) {
  return {
    listCustomersPage: customersServer(),
    listDeliveryOrdersPage: vi.fn().mockResolvedValue(pageOf([order])),
    createDeliveryOrder: vi.fn().mockResolvedValue(order),
    resolveGoogleMapsLink: vi.fn().mockResolvedValue({ latitude: -12.1, longitude: -77.02 }),
    editDeliveryOrder: vi.fn().mockResolvedValue(order),
    cancelDeliveryOrder: vi.fn().mockResolvedValue({ ...order, status: 'cancelled' }),
    listDeliveryOrderStatusHistory: vi.fn().mockResolvedValue([]),
    importDeliveryOrders: vi.fn().mockResolvedValue({ importedOrders: [], rejectedOrders: [] }),
    downloadDeliveryOrderImportTemplate: vi.fn().mockResolvedValue(new Blob()),
    ...overrides,
  };
}

describe('DeliveryOrderManagementPage', () => {
  it('resolves the customer names of the visible orders by id and shows linked order details', async () => {
    const client = makeClient();
    render(<DeliveryOrderManagementPage client={client} />);

    await screen.findByText('LIM-2041');
    expect(client.listDeliveryOrdersPage).toHaveBeenCalledOnce();
    expect(client.listDeliveryOrdersPage).toHaveBeenCalledWith({ page: 1, pageSize: 10 }, expect.any(AbortSignal));
    expect(await screen.findByText('Acme Logística')).toBeTruthy();
    // Solo los clientes de la página, no el catálogo completo.
    expect(client.listCustomersPage).toHaveBeenCalledWith({ ids: [customer.id], pageSize: 100 }, expect.any(AbortSignal));
    expect(screen.getByText(/María Pérez/)).toBeTruthy();
    expect(screen.getByText(/Av\. Arequipa 123/)).toBeTruthy();
    expect(screen.getByText(/1\s+bulto/)).toBeTruthy();
    expect(screen.getByText('Franja AM')).toBeTruthy();

    const user = setupUser();
    await user.click(screen.getByRole('button', { name: 'Nuevo pedido' }));
    await user.click(screen.getByLabelText(/Cliente activo/));
    expect(await screen.findByRole('option', { name: /Acme Logística/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Cliente antiguo/ })).toBeNull();
    expect(client.listCustomersPage).toHaveBeenCalledWith(
      { status: 'active', sort: 'name:asc', pageSize: 20 }, expect.any(AbortSignal));
  });

  it('asks for names only of customers it has not resolved yet when the page changes', async () => {
    const other: Customer = { ...customer, id: 'customer-other', name: 'Beta Envíos', publicCode: 'BETA' };
    const second: DeliveryOrder = { ...order, id: 'order-2', publicCode: 'LIM-2042', customerId: other.id };
    const listCustomersPage = customersServer([customer, other]);
    const client = makeClient({
      listCustomersPage,
      listDeliveryOrdersPage: vi.fn().mockResolvedValueOnce(pageOf([order])).mockResolvedValue(pageOf([order, second])),
    });
    const user = setupUser();
    render(<DeliveryOrderManagementPage client={client} />);
    expect(await screen.findByText('Acme Logística')).toBeTruthy();

    await user.type(screen.getByPlaceholderText('Buscar pedido, destinatario, teléfono o dirección'), 'lim');
    expect(await screen.findByText('Beta Envíos')).toBeTruthy();
    const idRequests = listCustomersPage.mock.calls.map(([params]) => params.ids);
    expect(idRequests).toEqual([[customer.id], [other.id]]);
  });

  it('searches active customers on the server and keeps the chosen one visible', async () => {
    const user = setupUser();
    const beta: Customer = { ...customer, id: 'customer-beta', name: 'Beta Envíos', publicCode: 'BETA' };
    const listCustomersPage = customersServer([customer, beta, inactiveCustomer]);
    render(<DeliveryOrderManagementPage client={makeClient({ listCustomersPage })} />);
    await screen.findByText('LIM-2041');
    await user.click(screen.getByRole('button', { name: 'Nuevo pedido' }));

    const combobox = screen.getByRole('combobox', { name: /Cliente activo/ });
    await user.click(combobox);
    expect(combobox.getAttribute('aria-expanded')).toBe('true');
    await user.type(screen.getByRole('combobox', { name: 'Buscar cliente activo' }), 'beta');
    await waitFor(() => expect(listCustomersPage).toHaveBeenLastCalledWith(
      { status: 'active', q: 'beta', sort: 'name:asc', pageSize: 20 }, expect.any(AbortSignal)));
    await waitFor(() => expect(screen.queryByRole('option', { name: /Acme Logística/ })).toBeNull());
    // Teclado: flecha y Enter eligen el resultado.
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(combobox.textContent).toContain('Beta Envíos · BETA'));

    // Otra búsqueda que no lo incluye no borra la selección.
    await user.click(combobox);
    await user.type(screen.getByRole('combobox', { name: 'Buscar cliente activo' }), 'zzz');
    expect(await screen.findByText('Ningún cliente activo coincide con la búsqueda.')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(combobox.textContent).toContain('Beta Envíos · BETA');
  });

  it('explains that there are no active customers and blocks creating', async () => {
    const user = setupUser();
    render(<DeliveryOrderManagementPage client={makeClient({ listCustomersPage: customersServer([inactiveCustomer]) })} />);
    await screen.findByText('LIM-2041');
    await user.click(screen.getByRole('button', { name: 'Nuevo pedido' }));

    expect(await screen.findByText('No hay clientes activos. Activa o registra un cliente antes de crear pedidos.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Crear pedido' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('creates an order using the active customer and only supported optional fields', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<DeliveryOrderManagementPage client={client} />);

    await screen.findByText('LIM-2041');
    await user.click(screen.getByRole('button', { name: 'Nuevo pedido' }));
    await chooseOption(user, screen.getByLabelText(/Cliente activo/), /Acme Logística/);
    await chooseOption(user, screen.getByLabelText(/Franja de entrega/), /^PM/);
    await user.type(screen.getByLabelText(/Nombre del destinatario/), 'Luis Soto');
    await user.type(screen.getByLabelText(/Teléfono del destinatario/), '999 222 333');
    await user.type(screen.getByLabelText(/Dirección/), 'Jr. Los Olivos 55');
    await user.type(screen.getByLabelText(/Distrito/), 'Miraflores');
    await user.type(screen.getByLabelText(/^Latitud/), '-12.1211');
    await user.type(screen.getByLabelText(/^Longitud/), '-77.0297');
    await user.type(screen.getByLabelText(/Descripción del bulto 1/), 'Caja pequeña');
    await user.click(screen.getByRole('button', { name: 'Crear pedido' }));

    await waitFor(() => expect(client.createDeliveryOrder).toHaveBeenCalledOnce());
    expect(client.createDeliveryOrder).toHaveBeenCalledWith({
      customerId: customer.id,
      timeWindow: 'PM',
      recipient: { name: 'Luis Soto', phone: '999 222 333' },
      deliveryAddress: { addressLine: 'Jr. Los Olivos 55', district: 'Miraflores', latitude: -12.1211, longitude: -77.0297 },
      packages: [{ description: 'Caja pequeña' }],
    });
    expect((await screen.findByRole('dialog')).textContent).toContain('se registró correctamente');
  });

  it('fills editable coordinates from a Google Maps link and keeps the link on create', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<DeliveryOrderManagementPage client={client} />);
    await screen.findByText('LIM-2041');
    const link = 'https://maps.app.goo.gl/place';
    await user.click(screen.getByRole('button', { name: 'Nuevo pedido' }));
    await user.type(screen.getByLabelText(/Enlace de Google Maps/), link);
    await user.click(screen.getByRole('button', { name: 'Obtener coordenadas' }));
    await waitFor(() => expect(client.resolveGoogleMapsLink).toHaveBeenCalledWith(link));
    await waitFor(() => expect((screen.getByLabelText(/^Latitud/) as HTMLInputElement).value).toBe('-12.1'));
    expect((screen.getByLabelText(/^Longitud/) as HTMLInputElement).value).toBe('-77.02');
    await user.clear(screen.getByLabelText(/^Latitud/));
    await user.type(screen.getByLabelText(/^Latitud/), '-12.2');
    await chooseOption(user, screen.getByLabelText(/Cliente activo/), /Acme Logística/);
    await chooseOption(user, screen.getByLabelText(/Franja de entrega/), /^PM/);
    await user.type(screen.getByLabelText(/Nombre del destinatario/), 'Luis Soto');
    await user.type(screen.getByLabelText(/Teléfono del destinatario/), '999 222 333');
    await user.type(screen.getByLabelText(/^Dirección/), 'Jr. Los Olivos 55');
    await user.type(screen.getByLabelText(/Distrito/), 'Miraflores');
    await user.type(screen.getByLabelText(/Descripción del bulto 1/), 'Caja pequeña');
    await user.click(screen.getByRole('button', { name: 'Crear pedido' }));
    await waitFor(() => expect(client.createDeliveryOrder).toHaveBeenCalledWith(expect.objectContaining({
      deliveryAddress: expect.objectContaining({ googleMapsUrl: link, latitude: -12.2, longitude: -77.02 }),
    })));
  });

  it('explains why a Google Maps link gave no coordinates', async () => {
    const user = setupUser();
    const client = makeClient({
      resolveGoogleMapsLink: vi.fn().mockRejectedValue(new ApiError('unresolved', 422, 'GOOGLE_MAPS_LINK_UNRESOLVED',
        { reason: 'no_coordinates' })),
    });
    render(<DeliveryOrderManagementPage client={client} />);
    await screen.findByText('LIM-2041');
    await user.click(screen.getByRole('button', { name: 'Nuevo pedido' }));
    await user.type(screen.getByLabelText(/Enlace de Google Maps/), 'https://maps.app.goo.gl/sin-lugar');
    await user.click(screen.getByRole('button', { name: 'Obtener coordenadas' }));

    expect(await screen.findByText(/El enlace no trae coordenadas/)).toBeTruthy();
  });

  it('offers CSV/XLSX import and the Excel template', async () => {
    render(<DeliveryOrderManagementPage client={makeClient()} />);

    await setupUser().click(await screen.findByRole('button', { name: 'Importar pedidos' }));
    expect(await screen.findByLabelText(/archivo de pedidos/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /descargar plantilla excel/i })).toBeTruthy();
  });

  it('uploads a file and reports imported and rejected order groups', async () => {
    const user = setupUser();
    const file = new File(['csv'], 'orders.csv', { type: 'text/csv' });
    const imported = { ...order, id: 'order-imported', publicCode: 'IMP-2' };
    const client = makeClient({
      listDeliveryOrdersPage: vi.fn().mockResolvedValueOnce(pageOf([order])).mockResolvedValue(pageOf([imported, order])),
      importDeliveryOrders: vi.fn().mockResolvedValue({
        importedOrders: [imported],
        rejectedOrders: [{
          publicCode: 'IMP-1', rowNumbers: [2, 3],
          issues: [{ rowNumber: 3, field: 'packageDescription', message: 'Required.' }],
        }],
      }),
    });
    render(<DeliveryOrderManagementPage client={client} />);

    await screen.findByText('LIM-2041');
    await user.click(screen.getByRole('button', { name: 'Importar pedidos' }));
    await user.upload(screen.getByLabelText(/archivo de pedidos/i), file);
    await user.click(screen.getByRole('button', { name: 'Importar pedidos' }));

    expect(await screen.findByText('Importación finalizada: 1 pedido importado y 1 pedido rechazado.')).toBeTruthy();
    expect(screen.getByText(/IMP-1/)).toBeTruthy();
    expect(screen.getByText(/filas 2, 3/)).toBeTruthy();
    expect(client.importDeliveryOrders).toHaveBeenCalledWith(file);
    // La lista se vuelve a pedir al servidor en vez de editarse en local.
    expect(await screen.findByText('IMP-2')).toBeTruthy();
    expect(client.listDeliveryOrdersPage).toHaveBeenCalledTimes(2);
  });

  it('sends search, facet filters and server sort fields as page parameters', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<DeliveryOrderManagementPage client={client} />);
    await screen.findByText('LIM-2041');

    await user.type(screen.getByPlaceholderText('Buscar pedido, destinatario, teléfono o dirección'), 'lince');
    await waitFor(() => expect(client.listDeliveryOrdersPage).toHaveBeenLastCalledWith(
      { page: 1, pageSize: 10, q: 'lince' }, expect.any(AbortSignal)));

    await user.click(screen.getByRole('button', { name: /Destinatario/ }));
    await waitFor(() => expect(client.listDeliveryOrdersPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: expect.stringMatching(/^recipientName:(asc|desc)$/) }), expect.any(AbortSignal)));
    // Cliente y bultos no se pueden ordenar en el servidor.
    expect(screen.queryByRole('button', { name: /^Cliente/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Bultos/ })).toBeNull();
  });

  it('loads and shows tenant-scoped status history on demand', async () => {
    const user = setupUser();
    const client = makeClient({
      listDeliveryOrderStatusHistory: vi.fn().mockResolvedValue([
        { fromStatus: 'created', toStatus: 'cancelled', actorUserId: 'admin-1', occurredAt: '2026-10-29T12:30:00.000Z' },
      ]),
    });
    render(<DeliveryOrderManagementPage client={client} />);

    await screen.findByText('LIM-2041');
    await chooseRowAction(user, 'Acciones de LIM-2041', 'Ver detalle');

    expect(await screen.findByText(/Creado → Cancelado/)).toBeTruthy();
    expect(client.listDeliveryOrderStatusHistory).toHaveBeenCalledWith(order.id);
  });

  it('links the order detail to its stored coordinates in Google Maps to check them against the address', async () => {
    const user = setupUser();
    const located: DeliveryOrder = { ...order, deliveryAddress: { ...order.deliveryAddress, latitude: -12.0840, longitude: -77.0350 } };
    const client = makeClient({ listDeliveryOrdersPage: vi.fn().mockResolvedValue(pageOf([located])) });
    render(<DeliveryOrderManagementPage client={client} />);

    await screen.findByText('LIM-2041');
    await chooseRowAction(user, 'Acciones de LIM-2041', 'Ver detalle');

    const link = await screen.findByRole('link', { name: 'Ver ubicación en Google Maps' });
    expect(link.getAttribute('href')).toBe('https://www.google.com/maps/search/?api=1&query=-12.084%2C-77.035');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.getByText('Lat -12.084 · Lng -77.035')).toBeTruthy();
  });

  it('says when an order has no coordinates instead of offering a map link', async () => {
    const user = setupUser();
    render(<DeliveryOrderManagementPage client={makeClient()} />);

    await screen.findByText('LIM-2041');
    await chooseRowAction(user, 'Acciones de LIM-2041', 'Ver detalle');

    expect(await screen.findByText('Sin coordenadas registradas.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Ver ubicación en Google Maps' })).toBeNull();
  });

  it('marks the returned status-history event as a reported incident', async () => {
    const user = setupUser();
    const client = makeClient({
      listDeliveryOrderStatusHistory: vi.fn().mockResolvedValue([
        { fromStatus: 'in_transit', toStatus: 'returned', actorUserId: 'driver-1', occurredAt: '2026-10-29T12:30:00.000Z' },
      ]),
    });
    render(<DeliveryOrderManagementPage client={client} />);

    await screen.findByText('LIM-2041');
    await chooseRowAction(user, 'Acciones de LIM-2041', 'Ver detalle');

    expect(await screen.findByText(/Incidencia reportada/)).toBeTruthy();
  });

  it('shows status-history loading and the empty-history state', async () => {
    const user = setupUser();
    let finishHistory!: (events: readonly DeliveryOrderStatusHistory[]) => void;
    const client = makeClient({
      listDeliveryOrderStatusHistory: vi.fn().mockReturnValue(new Promise((resolve) => { finishHistory = resolve; })),
    });
    render(<DeliveryOrderManagementPage client={client} />);

    await screen.findByText('LIM-2041');
    await chooseRowAction(user, 'Acciones de LIM-2041', 'Ver detalle');
    expect(await screen.findByText('Cargando historial…')).toBeTruthy();
    finishHistory([]);

    expect(await screen.findByText('Sin cambios de estado registrados.')).toBeTruthy();
  });

  it('shows history errors and allows retrying the request', async () => {
    const user = setupUser();
    const client = makeClient({
      listDeliveryOrderStatusHistory: vi.fn().mockRejectedValueOnce(new Error('network error')).mockResolvedValue([
        { fromStatus: 'created', toStatus: 'cancelled', actorUserId: 'admin-1', occurredAt: '2026-10-29T12:30:00.000Z' },
      ]),
    });
    render(<DeliveryOrderManagementPage client={client} />);

    await screen.findByText('LIM-2041');
    await chooseRowAction(user, 'Acciones de LIM-2041', 'Ver detalle');
    expect(await screen.findByText('No se pudo cargar el historial. Inténtalo de nuevo.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText(/Creado → Cancelado/)).toBeTruthy();
    expect(client.listDeliveryOrderStatusHistory).toHaveBeenCalledTimes(2);
  });

  it('surfaces inactive customer conflict and allows retrying failed list loads', async () => {
    const user = setupUser();
    const client = makeClient({
      listDeliveryOrdersPage: vi.fn().mockRejectedValueOnce(new Error('fallo de red')).mockResolvedValue(pageOf([order])),
      createDeliveryOrder: vi.fn().mockRejectedValue(Object.assign(new Error('Cliente inactivo'), {
        status: 409, code: 'CUSTOMER_INACTIVE',
      })),
    });
    render(<DeliveryOrderManagementPage client={client} />);

    expect(await screen.findByText('No se pudieron cargar los pedidos y clientes. Revisa la conexión e inténtalo de nuevo.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByText('LIM-2041');
    await user.click(screen.getByRole('button', { name: 'Nuevo pedido' }));
    await chooseOption(user, screen.getByLabelText(/Cliente activo/), /Acme Logística/);
    await chooseOption(user, screen.getByLabelText(/Franja de entrega/), /^AM/);
    await user.type(screen.getByLabelText(/Nombre del destinatario/), 'Luis Soto');
    await user.type(screen.getByLabelText(/Teléfono del destinatario/), '999 222 333');
    await user.type(screen.getByLabelText(/Dirección/), 'Jr. Los Olivos 55');
    await user.type(screen.getByLabelText(/Distrito/), 'Miraflores');
    await user.type(screen.getByLabelText(/^Latitud/), '-12.1211');
    await user.type(screen.getByLabelText(/^Longitud/), '-77.0297');
    await user.type(screen.getByLabelText(/Descripción del bulto 1/), 'Caja pequeña');
    await user.click(screen.getByRole('button', { name: 'Crear pedido' }));

    expect((await screen.findByText(/El cliente seleccionado ya no está activo/)).textContent).toContain('El cliente seleccionado ya no está activo');
  });

  it('requires customer and time window with Spanish messages before calling the API', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<DeliveryOrderManagementPage client={client} />);

    await screen.findByText('LIM-2041');
    await user.click(screen.getByRole('button', { name: 'Nuevo pedido' }));
    await user.type(screen.getByLabelText(/Nombre del destinatario/), 'Luis Soto');
    await user.type(screen.getByLabelText(/Teléfono del destinatario/), '999 222 333');
    await user.type(screen.getByLabelText(/^Dirección/), 'Jr. Los Olivos 55');
    await user.type(screen.getByLabelText(/Distrito/), 'Miraflores');
    await user.type(screen.getByLabelText(/^Latitud/), '-12.1211');
    await user.type(screen.getByLabelText(/^Longitud/), '-77.0297');
    await user.type(screen.getByLabelText(/Descripción del bulto 1/), 'Caja pequeña');
    await user.click(screen.getByRole('button', { name: 'Crear pedido' }));

    expect(await screen.findByText('Selecciona un cliente.')).toBeTruthy();
    expect(screen.getByText('Selecciona una franja.')).toBeTruthy();
    expect(client.createDeliveryOrder).not.toHaveBeenCalled();

    await chooseOption(user, screen.getByLabelText(/Cliente activo/), /Acme Logística/);
    expect(screen.queryByText('Selecciona un cliente.')).toBeNull();
  });

  it('keeps native validation for phone pattern and required inputs', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<DeliveryOrderManagementPage client={client} />);

    await screen.findByText('LIM-2041');
    await user.click(screen.getByRole('button', { name: 'Nuevo pedido' }));
    await chooseOption(user, screen.getByLabelText(/Cliente activo/), /Acme Logística/);
    await chooseOption(user, screen.getByLabelText(/Franja de entrega/), /^PM/);
    await user.type(screen.getByLabelText(/Teléfono del destinatario/), 'no es un teléfono');
    await user.click(screen.getByRole('button', { name: 'Crear pedido' }));

    expect((screen.getByLabelText(/Teléfono del destinatario/) as HTMLInputElement).validity.patternMismatch).toBe(true);
    expect((screen.getByLabelText(/Nombre del destinatario/) as HTMLInputElement).validity.valueMissing).toBe(true);
    expect(client.createDeliveryOrder).not.toHaveBeenCalled();
  });

  it('requires delivery coordinates before calling the API', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<DeliveryOrderManagementPage client={client} />);

    await screen.findByText('LIM-2041');
    await user.click(screen.getByRole('button', { name: 'Nuevo pedido' }));
    await chooseOption(user, screen.getByLabelText(/Cliente activo/), /Acme Logística/);
    await chooseOption(user, screen.getByLabelText(/Franja de entrega/), /^PM/);
    await user.type(screen.getByLabelText(/Nombre del destinatario/), 'Luis Soto');
    await user.type(screen.getByLabelText(/Teléfono del destinatario/), '999 222 333');
    await user.type(screen.getByLabelText(/^Dirección/), 'Jr. Los Olivos 55');
    await user.type(screen.getByLabelText(/Distrito/), 'Miraflores');
    await user.type(screen.getByLabelText(/Descripción del bulto 1/), 'Caja pequeña');
    await user.click(screen.getByRole('button', { name: 'Crear pedido' }));

    expect((screen.getByLabelText(/^Latitud/) as HTMLInputElement).validity.valueMissing).toBe(true);
    expect((screen.getByLabelText(/^Longitud/) as HTMLInputElement).validity.valueMissing).toBe(true);
    expect(client.createDeliveryOrder).not.toHaveBeenCalled();
  });

  it('asks for confirmation before cancelling and refreshes the order list', async () => {
    const user = setupUser();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const client = makeClient({
      listDeliveryOrdersPage: vi.fn().mockResolvedValueOnce(pageOf([order]))
        .mockResolvedValue(pageOf([{ ...order, status: 'cancelled' }])),
    });
    render(<DeliveryOrderManagementPage client={client} />);

    await screen.findByText('LIM-2041');
    await chooseRowAction(user, 'Acciones de LIM-2041', 'Cancelar pedido');
    expect(confirm).toHaveBeenCalledOnce();
    expect(client.cancelDeliveryOrder).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await chooseRowAction(user, 'Acciones de LIM-2041', 'Cancelar pedido');
    await waitFor(() => expect(client.cancelDeliveryOrder).toHaveBeenCalledWith(order.id));
    expect(await screen.findByText('Cancelado')).toBeTruthy();
  });

  it('edits a created order, keeping its customer, time window and existing package codes', async () => {
    const user = setupUser();
    const located: DeliveryOrder = { ...order, deliveryAddress: { ...order.deliveryAddress, latitude: -12.08, longitude: -77.03 } };
    const updated: DeliveryOrder = { ...located, recipient: { name: 'Lucía Ramos', phone: '999 000 111' } };
    const client = makeClient({
      listDeliveryOrdersPage: vi.fn().mockResolvedValueOnce(pageOf([located])).mockResolvedValue(pageOf([updated])),
      editDeliveryOrder: vi.fn().mockResolvedValue(updated),
    });
    render(<DeliveryOrderManagementPage client={client} />);

    await screen.findByText('LIM-2041');
    await chooseRowAction(user, 'Acciones de LIM-2041', 'Editar pedido');
    expect((screen.getByLabelText('Cliente') as HTMLInputElement).value).toBe('Acme Logística');
    expect((screen.getByLabelText('Cliente') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Franja de entrega') as HTMLInputElement).disabled).toBe(true);
    const name = screen.getByLabelText(/Nombre del destinatario/);
    await user.clear(name);
    await user.type(name, 'Lucía Ramos');
    await user.click(screen.getByRole('button', { name: 'Añadir bulto' }));
    await user.type(screen.getByLabelText('Descripción del bulto 2 *'), 'Sobre');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(client.editDeliveryOrder).toHaveBeenCalledWith('order-1', {
      recipient: { name: 'Lucía Ramos', phone: '999 000 111' },
      deliveryAddress: { addressLine: 'Av. Arequipa 123', district: 'Lince', latitude: -12.08, longitude: -77.03 },
      packages: [{ code: 'PKG-01', description: 'Caja mediana' }, { description: 'Sobre' }],
    }));
    expect((await screen.findByRole('status')).textContent).toContain('Pedido LIM-2041 actualizado.');
    expect(screen.getByText(/Lucía Ramos/)).toBeTruthy();
  });

  it('offers editing only while the order is created', async () => {
    const user = setupUser();
    const client = makeClient({ listDeliveryOrdersPage: vi.fn().mockResolvedValue(pageOf([{ ...order, status: 'planned' }])) });
    render(<DeliveryOrderManagementPage client={client} />);

    await screen.findByText('LIM-2041');
    await user.click(screen.getByRole('button', { name: 'Acciones de LIM-2041' }));
    expect(await screen.findByRole('menuitem', { name: 'Cancelar pedido' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Editar pedido' })).toBeNull();
  });
});
