/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chooseOption, setupUser } from '../test/ui.js';

import type { ApiClient, DispatchRoute, Driver, PageParams, Vehicle, VehicleRouteStats } from '../api/client.js';
import { VehicleManagementPage } from './VehicleManagementPage.js';

const vehicle: Vehicle = {
  id: 'vehicle-1', organizationId: 'org-1', plate: 'ABC-123', type: 'Van',
  capacityKg: 1200, status: 'active', createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

const driver: Driver = {
  id: 'driver-1', organizationId: 'org-1', fullName: 'Valeria Gomez', documentNumber: 'DNI-123456',
  phone: '900 000 101', licenseNumber: 'A-123456', status: 'active',
  createdAt: '2026-11-02T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z',
};

const route: DispatchRoute = {
  id: 'route-1', organizationId: 'org-1', publicCode: 'RUT-0001', plannedDate: '2026-11-06T05:00:00.000Z',
  driverId: driver.id, vehicleId: vehicle.id, status: 'completed', createdAt: '2026-11-05T10:00:00.000Z',
  stops: [
    { id: 'stop-1', sequence: 1, addressLine: 'Av. Arequipa 100', latitude: null, longitude: null, orderIds: ['o-1', 'o-2'] },
    { id: 'stop-2', sequence: 2, addressLine: 'Av. Brasil 200', latitude: null, longitude: null, orderIds: ['o-3'] },
  ],
};

const stats: VehicleRouteStats = {
  vehicleId: vehicle.id, routes: 1, completed: 1, stops: 2, orders: 3, lastRouteDay: '2026-11-06',
  monthly: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']
    .map((month) => ({ month, routes: month === '2026-11' ? 1 : 0 })),
};

const page = <T,>(data: readonly T[], total = data.length) => ({ data, meta: { page: 1, pageSize: 20, total } });

/** Paginates and filters like `GET /vehicles`: `status` and `q` (plate or type), counts ignore `status`. */
function fleetPage(fleet: readonly Vehicle[]) {
  return async (params: PageParams) => {
    const needle = String(params.q ?? '').toLowerCase();
    const searched = fleet.filter((item) => needle === '' || `${item.plate} ${item.type}`.toLowerCase().includes(needle));
    const statuses = params.status === undefined ? undefined : String(params.status).split(',');
    const filtered = searched.filter((item) => statuses === undefined || statuses.includes(item.status));
    const pageSize = Number(params.pageSize ?? 20);
    const start = (Number(params.page ?? 1) - 1) * pageSize;
    return {
      data: filtered.slice(start, start + pageSize),
      meta: {
        page: Number(params.page ?? 1), pageSize, total: filtered.length,
        counts: { status: {
          active: searched.filter((item) => item.status === 'active').length,
          inactive: searched.filter((item) => item.status === 'inactive').length,
        } },
      },
    };
  };
}

function buildClient(fleet: readonly Vehicle[] = [vehicle]) {
  return {
    listVehiclesPage: vi.fn().mockImplementation(fleetPage(fleet)),
    createVehicle: vi.fn().mockResolvedValue({ ...vehicle, id: 'vehicle-2', plate: 'XYZ-987' }),
    updateVehicle: vi.fn().mockResolvedValue({ ...vehicle, status: 'inactive' }),
    getVehicleRouteStats: vi.fn().mockResolvedValue([stats]),
    listDispatchRoutesPage: vi.fn().mockImplementation(async (params: PageParams) =>
      page(params.vehicleId === vehicle.id ? [route] : [])),
    listDrivers: vi.fn().mockResolvedValue([driver]),
  } satisfies Pick<ApiClient, 'listVehiclesPage' | 'createVehicle' | 'updateVehicle' | 'getVehicleRouteStats'
    | 'listDispatchRoutesPage' | 'listDrivers'>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VehicleManagementPage', () => {
  it('shows the tenant vehicle catalog and registers a vehicle with optional capacity', async () => {
    const user = setupUser();
    const client = buildClient();
    render(<VehicleManagementPage client={client} />);

    const item = await screen.findByRole('listitem', { name: /ABC-123/ });
    expect(within(item).getByText(/Van/)).toBeTruthy();
    expect(screen.getByText('1,200 kg')).toBeTruthy();
    expect(screen.getByText('1 de 1 vehículos activos.')).toBeTruthy();
    client.listVehiclesPage.mockImplementation(fleetPage([vehicle, { ...vehicle, id: 'vehicle-2', plate: 'XYZ-987' }]));

    await user.click(screen.getByRole('button', { name: 'Registrar vehículo' }));
    await user.type(screen.getByLabelText('Placa'), 'xyz-987');
    await user.type(screen.getByLabelText('Tipo de vehículo'), 'Camión ligero');
    await user.type(screen.getByLabelText(/Capacidad \(kg\)/), '2500');
    await user.click(screen.getByRole('button', { name: 'Registrar vehículo' }));

    await waitFor(() => expect(client.createVehicle).toHaveBeenCalledWith({
      plate: 'xyz-987', type: 'Camión ligero', capacityKg: 2500,
    }));
    const confirmation = await screen.findByRole('dialog', { name: 'Vehículo registrado' });
    expect(within(confirmation).getByText('El vehículo XYZ-987 se registró correctamente.')).toBeTruthy();
    await user.click(within(confirmation).getByRole('button', { name: 'Entendido' }));
    expect(await screen.findByRole('listitem', { name: /XYZ-987/ })).toBeTruthy();
  });

  it('summarizes the selected vehicle routes from the server stats and pages its history', async () => {
    const client = buildClient();
    render(<VehicleManagementPage client={client} />);

    const item = await screen.findByRole('listitem', { name: /ABC-123/ });
    expect(within(item).getByText('Rutas').nextElementSibling?.textContent).toBe('1');
    expect(within(item).getByText('Paradas').nextElementSibling?.textContent).toBe('2');
    expect(within(item).getByText('Pedidos').nextElementSibling?.textContent).toBe('3');

    expect(screen.getByText('1 de 1')).toBeTruthy();
    const history = await screen.findByRole('row', { name: /RUT-0001/ });
    expect(within(history).getByText('Valeria Gomez')).toBeTruthy();
    expect(within(history).getByText('Completada')).toBeTruthy();
    // Aggregates come from the server; only the selected vehicle's latest routes are listed.
    expect(client.getVehicleRouteStats).toHaveBeenCalledOnce();
    expect(client.listDispatchRoutesPage).toHaveBeenCalledWith(
      { vehicleId: vehicle.id, pageSize: 20, sort: 'plannedDate:desc' }, expect.any(AbortSignal));
    expect(screen.queryByText(/más recientes de/)).toBeNull();
  });

  it('says when the history shows only the latest routes', async () => {
    const client = buildClient();
    client.listDispatchRoutesPage.mockResolvedValue(page([route], 45));
    render(<VehicleManagementPage client={client} />);

    expect(await screen.findByText(/Mostrando las 1 más recientes de 45./)).toBeTruthy();
  });

  it('shows dashes for the totals when the server stats fail', async () => {
    const client = buildClient();
    client.getVehicleRouteStats.mockRejectedValueOnce(new Error('offline'));
    render(<VehicleManagementPage client={client} />);

    expect(await screen.findByText('Sin datos de rutas por ahora.')).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(await screen.findByRole('row', { name: /RUT-0001/ })).toBeTruthy();
  });

  it('switches the detail to the vehicle chosen in the list', async () => {
    const user = setupUser();
    const client = buildClient();
    const moto: Vehicle = { ...vehicle, id: 'vehicle-2', plate: 'MOT-001', type: 'Moto', capacityKg: null };
    client.listVehiclesPage.mockImplementation(fleetPage([vehicle, moto]));
    render(<VehicleManagementPage client={client} />);

    const item = await screen.findByRole('listitem', { name: /MOT-001/ });
    await user.click(within(item).getByRole('button', { name: /MOT-001/ }));
    expect(within(item).getByRole('button', { name: /MOT-001/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('No especificada')).toBeTruthy();
    expect(await screen.findByText('Aún no tiene rutas')).toBeTruthy();
    expect(client.listDispatchRoutesPage).toHaveBeenLastCalledWith(
      { vehicleId: 'vehicle-2', pageSize: 20, sort: 'plannedDate:desc' }, expect.any(AbortSignal));
  });

  it('supports an unknown capacity and updates type, capacity and active availability without changing plate', async () => {
    const user = setupUser();
    const client = buildClient();
    render(<VehicleManagementPage client={client} />);

    await screen.findByRole('listitem', { name: /ABC-123/ });
    client.listVehiclesPage.mockImplementation(fleetPage([{ ...vehicle, status: 'inactive', capacityKg: null }]));
    await user.click(screen.getByRole('button', { name: 'Editar vehículo ABC-123' }));
    const sheet = screen.getByRole('dialog', { name: 'Editar ABC-123' });
    expect(within(sheet).queryByLabelText('Placa')).toBeNull();
    await user.clear(within(sheet).getByLabelText('Capacidad (kg)'));
    await chooseOption(user, within(sheet).getByLabelText('Disponibilidad'), 'Inactivo');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(client.updateVehicle).toHaveBeenCalledWith(vehicle.id, {
      type: vehicle.type, capacityKg: null, status: 'inactive',
    }));
    const item = await screen.findByRole('listitem', { name: /ABC-123/ });
    expect(await within(item).findByText('Inactivo')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the sheet open with its typed values and shows the error inside when saving fails', async () => {
    const user = setupUser();
    const client = buildClient();
    client.createVehicle.mockRejectedValueOnce(new Error('Placa duplicada'));
    render(<VehicleManagementPage client={client} />);

    await user.click(await screen.findByRole('button', { name: 'Registrar vehículo' }));
    await user.type(screen.getByLabelText('Placa'), 'ABC-123');
    await user.type(screen.getByLabelText('Tipo de vehículo'), 'Van');
    await user.click(screen.getByRole('button', { name: 'Registrar vehículo' }));

    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText(/Placa duplicada/)).toBeTruthy();
    expect(within(sheet).getByLabelText('Placa')).toHaveProperty('value', 'ABC-123');
  });

  it('still lists the fleet when route history cannot be loaded', async () => {
    const client = buildClient();
    client.listDispatchRoutesPage.mockRejectedValueOnce(new Error('offline'));
    render(<VehicleManagementPage client={client} />);

    expect(await screen.findByRole('listitem', { name: /ABC-123/ })).toBeTruthy();
    expect(await screen.findByText(/No se pudo cargar el historial de rutas/)).toBeTruthy();
  });

  it('keeps loading errors, empty catalogs and retry accessible', async () => {
    const user = setupUser();
    const client = buildClient();
    client.listVehiclesPage.mockRejectedValueOnce(new Error('offline')).mockImplementation(fleetPage([]));
    render(<VehicleManagementPage client={client} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Aún no hay vehículos')).toBeTruthy();
  });

  it('searches, filters by availability and pages the fleet on the server', async () => {
    const user = setupUser();
    const fleet = Array.from({ length: 12 }, (_, index): Vehicle => ({
      ...vehicle, id: `vehicle-${index + 1}`, plate: `PLT-${String(index + 1).padStart(3, '0')}`,
      type: index === 11 ? 'Moto' : 'Van', status: index < 9 ? 'active' : 'inactive',
    }));
    const client = buildClient(fleet);
    render(<VehicleManagementPage client={client} />);

    expect(await screen.findByRole('listitem', { name: /PLT-001/ })).toBeTruthy();
    expect(screen.getByText('9 de 12 vehículos activos.')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(client.listVehiclesPage).toHaveBeenLastCalledWith({ page: 1, pageSize: 10 }, expect.any(AbortSignal));

    await user.click(screen.getByRole('button', { name: 'Página siguiente de vehículos' }));
    expect(await screen.findByRole('listitem', { name: /PLT-012/ })).toBeTruthy();
    expect(screen.getByText('Página 2 de 2')).toBeTruthy();

    const filters = screen.getByRole('group', { name: 'Filtrar vehículos' });
    expect(within(filters).getByRole('button', { name: /Inactivos/ }).textContent).toContain('3');
    await user.click(within(filters).getByRole('button', { name: /Inactivos/ }));
    await waitFor(() => expect(client.listVehiclesPage).toHaveBeenLastCalledWith(
      { status: 'inactive', page: 1, pageSize: 10 }, expect.any(AbortSignal)));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3));

    await user.click(within(filters).getByRole('button', { name: /Todos/ }));
    await user.type(screen.getByLabelText('Buscar vehículos'), 'moto');
    await waitFor(() => expect(client.listVehiclesPage).toHaveBeenLastCalledWith(
      { page: 1, pageSize: 10, q: 'moto' }, expect.any(AbortSignal)));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    // The fleet summary keeps describing the whole fleet while searching.
    expect(screen.getByText('9 de 12 vehículos activos.')).toBeTruthy();

    await user.clear(screen.getByLabelText('Buscar vehículos'));
    await user.type(screen.getByLabelText('Buscar vehículos'), 'zzz');
    expect(await screen.findByText('Ningún vehículo coincide')).toBeTruthy();
  });
});
