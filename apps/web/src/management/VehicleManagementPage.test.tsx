/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chooseOption, chooseRowAction, setupUser } from '../test/ui.js';

import type { ApiClient, Vehicle } from '../api/client.js';
import { VehicleManagementPage } from './VehicleManagementPage.js';

const vehicle: Vehicle = {
  id: 'vehicle-1', organizationId: 'org-1', plate: 'ABC-123', type: 'Van',
  capacityKg: 1200, status: 'active', createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

function buildClient() {
  return {
    listVehicles: vi.fn().mockResolvedValue([vehicle]),
    createVehicle: vi.fn().mockResolvedValue({ ...vehicle, id: 'vehicle-2', plate: 'XYZ-987' }),
    updateVehicle: vi.fn().mockResolvedValue({ ...vehicle, status: 'inactive' }),
  } satisfies Pick<ApiClient, 'listVehicles' | 'createVehicle' | 'updateVehicle'>;
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

    const row = await screen.findByRole('row', { name: /ABC-123/ });
    expect(within(row).getByText('Van')).toBeTruthy();
    expect(within(row).getByText('1,200 kg')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Registrar vehículo' }));
    await user.type(screen.getByLabelText('Placa'), 'xyz-987');
    await user.type(screen.getByLabelText('Tipo de vehículo'), 'Camión ligero');
    await user.type(screen.getByLabelText(/Capacidad \(kg\)/), '2500');
    await user.click(screen.getByRole('button', { name: 'Registrar vehículo' }));

    await waitFor(() => expect(client.createVehicle).toHaveBeenCalledWith({
      plate: 'xyz-987', type: 'Camión ligero', capacityKg: 2500,
    }));
    expect(await screen.findByText('XYZ-987')).toBeTruthy();
  });

  it('supports an unknown capacity and updates type, capacity and active availability without changing plate', async () => {
    const user = setupUser();
    const client = buildClient();
    render(<VehicleManagementPage client={client} />);

    const row = await screen.findByRole('row', { name: /ABC-123/ });
    await chooseRowAction(user, 'Acciones de ABC-123', 'Editar vehículo');
    const sheet = screen.getByRole('dialog', { name: 'Editar ABC-123' });
    expect(within(sheet).queryByLabelText('Placa')).toBeNull();
    await user.clear(within(sheet).getByLabelText('Capacidad (kg)'));
    await chooseOption(user, within(sheet).getByLabelText('Disponibilidad'), 'Inactivo');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(client.updateVehicle).toHaveBeenCalledWith(vehicle.id, {
      type: vehicle.type, capacityKg: null, status: 'inactive',
    }));
    expect(within(row).getByText('ABC-123')).toBeTruthy();
    expect(await within(row).findByText('Inactivo')).toBeTruthy();
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
