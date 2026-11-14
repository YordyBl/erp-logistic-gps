/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chooseOption, setupUser } from '../test/ui.js';

import type { ApiClient, DispatchRoute, Driver, Vehicle } from '../api/client.js';
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

function buildClient() {
  return {
    listVehicles: vi.fn().mockResolvedValue([vehicle]),
    createVehicle: vi.fn().mockResolvedValue({ ...vehicle, id: 'vehicle-2', plate: 'XYZ-987' }),
    updateVehicle: vi.fn().mockResolvedValue({ ...vehicle, status: 'inactive' }),
    listDispatchRoutes: vi.fn().mockResolvedValue([route]),
    listDrivers: vi.fn().mockResolvedValue([driver]),
  } satisfies Pick<ApiClient, 'listVehicles' | 'createVehicle' | 'updateVehicle' | 'listDispatchRoutes' | 'listDrivers'>;
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

  it('summarizes the selected vehicle routes from the API with its history', async () => {
    render(<VehicleManagementPage client={buildClient()} />);

    const item = await screen.findByRole('listitem', { name: /ABC-123/ });
    expect(within(item).getByText('Rutas').nextElementSibling?.textContent).toBe('1');
    expect(within(item).getByText('Paradas').nextElementSibling?.textContent).toBe('2');
    expect(within(item).getByText('Pedidos').nextElementSibling?.textContent).toBe('3');

    expect(screen.getByText('1 de 1')).toBeTruthy();
    const history = screen.getByRole('row', { name: /RUT-0001/ });
    expect(within(history).getByText('Valeria Gomez')).toBeTruthy();
    expect(within(history).getByText('Completada')).toBeTruthy();
  });

  it('switches the detail to the vehicle chosen in the list', async () => {
    const user = setupUser();
    const client = buildClient();
    const moto: Vehicle = { ...vehicle, id: 'vehicle-2', plate: 'MOT-001', type: 'Moto', capacityKg: null };
    client.listVehicles.mockResolvedValue([vehicle, moto]);
    render(<VehicleManagementPage client={client} />);

    const item = await screen.findByRole('listitem', { name: /MOT-001/ });
    await user.click(within(item).getByRole('button', { name: /MOT-001/ }));
    expect(within(item).getByRole('button', { name: /MOT-001/ }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('No especificada')).toBeTruthy();
    expect(screen.getByText('Aún no tiene rutas')).toBeTruthy();
  });

  it('supports an unknown capacity and updates type, capacity and active availability without changing plate', async () => {
    const user = setupUser();
    const client = buildClient();
    render(<VehicleManagementPage client={client} />);

    const item = await screen.findByRole('listitem', { name: /ABC-123/ });
    await user.click(screen.getByRole('button', { name: 'Editar vehículo ABC-123' }));
    const sheet = screen.getByRole('dialog', { name: 'Editar ABC-123' });
    expect(within(sheet).queryByLabelText('Placa')).toBeNull();
    await user.clear(within(sheet).getByLabelText('Capacidad (kg)'));
    await chooseOption(user, within(sheet).getByLabelText('Disponibilidad'), 'Inactivo');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(client.updateVehicle).toHaveBeenCalledWith(vehicle.id, {
      type: vehicle.type, capacityKg: null, status: 'inactive',
    }));
    expect(within(item).getByText('ABC-123')).toBeTruthy();
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
    client.listDispatchRoutes.mockRejectedValueOnce(new Error('offline'));
    render(<VehicleManagementPage client={client} />);

    expect(await screen.findByRole('listitem', { name: /ABC-123/ })).toBeTruthy();
    expect(screen.getByText(/No se pudo cargar el historial de rutas/)).toBeTruthy();
  });

  it('keeps loading errors, empty catalogs and retry accessible', async () => {
    const user = setupUser();
    const client = buildClient();
    client.listVehicles.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    render(<VehicleManagementPage client={client} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Aún no hay vehículos')).toBeTruthy();
  });
});
