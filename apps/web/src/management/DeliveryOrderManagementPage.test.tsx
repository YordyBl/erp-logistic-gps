/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chooseOption, chooseRowAction, setupUser } from '../test/ui.js';

import type { Customer, DeliveryOrder, DeliveryOrderImportResult, DeliveryOrderStatusHistory } from '../api/client.js';
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeClient(overrides: Partial<{
  listCustomers: () => Promise<readonly Customer[]>;
  listDeliveryOrders: () => Promise<readonly DeliveryOrder[]>;
  createDeliveryOrder: (input: unknown) => Promise<DeliveryOrder>;
  resolveGoogleMapsLink: (url: string) => Promise<{ latitude: number; longitude: number }>;
  cancelDeliveryOrder: (id: string) => Promise<DeliveryOrder>;
  listDeliveryOrderStatusHistory: (id: string) => Promise<readonly DeliveryOrderStatusHistory[]>;
  importDeliveryOrders: (file: File) => Promise<DeliveryOrderImportResult>;
  downloadDeliveryOrderImportTemplate: () => Promise<Blob>;
}> = {}) {
  return {
    listCustomers: vi.fn().mockResolvedValue([customer, inactiveCustomer]),
    listDeliveryOrders: vi.fn().mockResolvedValue([order]),
    createDeliveryOrder: vi.fn().mockResolvedValue(order),
    resolveGoogleMapsLink: vi.fn().mockResolvedValue({ latitude: -12.1, longitude: -77.02 }),
    cancelDeliveryOrder: vi.fn().mockResolvedValue({ ...order, status: 'cancelled' }),
    listDeliveryOrderStatusHistory: vi.fn().mockResolvedValue([]),
    importDeliveryOrders: vi.fn().mockResolvedValue({ importedOrders: [], rejectedOrders: [] }),
    downloadDeliveryOrderImportTemplate: vi.fn().mockResolvedValue(new Blob()),
    ...overrides,
  };
}

describe('DeliveryOrderManagementPage', () => {
  it('loads customers and orders together and shows linked customer and order details', async () => {
    const client = makeClient();
    render(<DeliveryOrderManagementPage client={client} />);

    await screen.findByText('LIM-2041');
    expect(client.listCustomers).toHaveBeenCalledOnce();
    expect(client.listDeliveryOrders).toHaveBeenCalledOnce();
    expect(screen.getByText('Acme Logística')).toBeTruthy();
    expect(screen.getByText(/María Pérez/)).toBeTruthy();
    expect(screen.getByText(/Av\. Arequipa 123/)).toBeTruthy();
    expect(screen.getByText(/1\s+bulto/)).toBeTruthy();
    expect(screen.getByText('Franja AM')).toBeTruthy();

    const user = setupUser();
    await user.click(screen.getByRole('button', { name: 'Nuevo pedido' }));
    await user.click(screen.getByLabelText(/Cliente activo/));
    expect(await screen.findByRole('option', { name: /Acme Logística/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Cliente antiguo/ })).toBeNull();
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
    expect(await screen.findByText('IMP-2')).toBeTruthy();
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
      listDeliveryOrders: vi.fn().mockRejectedValueOnce(new Error('fallo de red')).mockResolvedValue([order]),
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
    const client = makeClient();
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
});
