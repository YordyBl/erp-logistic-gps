/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient, Driver, DriverAccountOption } from '../api/client.js';
import { DriverManagementPage } from './DriverManagementPage.js';

const driver: Driver = {
  id: 'driver-1', organizationId: 'org-1', fullName: 'Valeria Gomez', documentNumber: 'DNI-123456',
  phone: '+51 987 123 456', licenseNumber: 'A-123456', status: 'active',
  createdAt: '2026-11-02T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z',
};

const account: DriverAccountOption = {
  userId: 'user-1', email: 'valeria@example.test', status: 'active', driverId: null,
};

function buildClient() {
  return {
    listDrivers: vi.fn().mockResolvedValue([driver]),
    listDriverAccounts: vi.fn().mockResolvedValue([account]),
    createDriver: vi.fn().mockResolvedValue({ ...driver, id: 'driver-2', fullName: 'Luis Paredes' }),
    updateDriver: vi.fn().mockResolvedValue({ ...driver, phone: '+51 900 111 222' }),
    bindDriverAccount: vi.fn().mockResolvedValue({ driverId: driver.id, userId: account.userId }),
  } satisfies Pick<ApiClient, 'listDrivers' | 'listDriverAccounts' | 'createDriver' | 'updateDriver' | 'bindDriverAccount'>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DriverManagementPage', () => {
  it('lists driver details and registers a driver through the catalog API', async () => {
    const user = userEvent.setup();
    const client = buildClient();
    render(<DriverManagementPage client={client} canBindAccounts />);

    const row = await screen.findByRole('listitem', { name: /Valeria Gomez/ });
    expect(within(row).getByText('DNI-123456')).toBeTruthy();
    expect(within(row).getByText('A-123456')).toBeTruthy();

    await user.type(screen.getByLabelText('Nombre completo'), 'Luis Paredes');
    await user.type(screen.getByLabelText('Documento de identidad'), 'DNI-654321');
    await user.type(screen.getByLabelText('Teléfono'), '+51 900 111 222');
    await user.type(screen.getByLabelText('Licencia de conducir'), 'B-654321');
    await user.click(screen.getByRole('button', { name: 'Registrar conductor' }));

    await waitFor(() => expect(client.createDriver).toHaveBeenCalledWith({
      fullName: 'Luis Paredes', documentNumber: 'DNI-654321',
      phone: '+51 900 111 222', licenseNumber: 'B-654321', status: 'active',
    }));
    expect(await screen.findByText('Luis Paredes')).toBeTruthy();
  });

  it('updates editable profile fields without allowing identity-document changes', async () => {
    const user = userEvent.setup();
    const client = buildClient();
    render(<DriverManagementPage client={client} canBindAccounts />);

    const row = await screen.findByRole('listitem', { name: /Valeria Gomez/ });
    await user.click(within(row).getByRole('button', { name: 'Editar Valeria Gomez' }));
    const phone = within(row).getByLabelText('Teléfono');
    await user.clear(phone);
    await user.type(phone, '+51 900 111 222');
    await user.click(within(row).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(client.updateDriver).toHaveBeenCalledWith(driver.id, {
      fullName: driver.fullName, phone: '+51 900 111 222', licenseNumber: driver.licenseNumber,
      status: driver.status,
    }));
    expect(within(row).getByText('DNI-123456')).toBeTruthy();
    expect(within(row).queryByLabelText('Documento de identidad')).toBeNull();
  });

  it('lets an ADMIN link and unlink only an active account that is available or already assigned here', async () => {
    const user = userEvent.setup();
    const client = buildClient();
    client.listDriverAccounts
      .mockResolvedValueOnce([account])
      .mockResolvedValueOnce([{ ...account, driverId: driver.id }]);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    render(<DriverManagementPage client={client} canBindAccounts />);

    const row = await screen.findByRole('listitem', { name: /Valeria Gomez/ });
    await user.selectOptions(within(row).getByLabelText('Cuenta para Valeria Gomez'), account.userId);
    await user.click(within(row).getByRole('button', { name: 'Vincular cuenta' }));
    await waitFor(() => expect(client.bindDriverAccount).toHaveBeenCalledWith(driver.id, account.userId));
    expect(await within(row).findByText('valeria@example.test')).toBeTruthy();

    await user.click(within(row).getByRole('button', { name: 'Desvincular cuenta' }));
    await waitFor(() => expect(client.bindDriverAccount).toHaveBeenLastCalledWith(driver.id, null));
  });

  it('requires confirmation before linking an account', async () => {
    const user = userEvent.setup();
    const client = buildClient();
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    render(<DriverManagementPage client={client} canBindAccounts />);

    const row = await screen.findByRole('listitem', { name: /Valeria Gomez/ });
    await user.selectOptions(within(row).getByLabelText('Cuenta para Valeria Gomez'), account.userId);
    await user.click(within(row).getByRole('button', { name: 'Vincular cuenta' }));

    expect(confirm).toHaveBeenCalledWith('¿Vincular valeria@example.test con Valeria Gomez?');
    expect(client.bindDriverAccount).not.toHaveBeenCalled();
  });

  it('does not request or expose account identities to a DISPATCHER', async () => {
    const client = buildClient();
    render(<DriverManagementPage client={client} canBindAccounts={false} />);

    const row = await screen.findByRole('listitem', { name: /Valeria Gomez/ });
    expect(client.listDriverAccounts).not.toHaveBeenCalled();
    expect(within(row).queryByLabelText('Cuenta para Valeria Gomez')).toBeNull();
    expect(within(row).queryByText('valeria@example.test')).toBeNull();
    expect(within(row).getByText('Vinculación reservada a ADMIN')).toBeTruthy();
  });
});
