/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chooseOption, setupUser } from '../test/ui.js';

import type { ApiClient, Driver, DriverAccountOption, DriverRouteStats, PageParams } from '../api/client.js';
import { DriverManagementPage } from './DriverManagementPage.js';

const driver: Driver = {
  id: 'driver-1', organizationId: 'org-1', fullName: 'Valeria Gomez', documentNumber: 'DNI-123456',
  phone: '+51 987 123 456', licenseNumber: 'A-123456', status: 'active',
  createdAt: '2026-11-02T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z',
};

const trips: DriverRouteStats = {
  driverId: driver.id, routes: 12, completed: 9, stops: 30, orders: 41, lastRouteDay: '2026-11-14',
  monthly: [{ month: '2026-11', routes: 12 }],
};

const account: DriverAccountOption = {
  userId: 'user-1', email: 'valeria@example.test', status: 'active', driverId: null,
};

/** Paginates and filters like `GET /drivers`; the status and account facets ignore both chip filters. */
function crewPage(crew: readonly Driver[], linkedIds: ReadonlySet<string> = new Set()) {
  return async (params: PageParams) => {
    const fold = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const needle = fold(String(params.q ?? ''));
    const searched = crew.filter((item) => needle === '' ||
      [item.fullName, item.documentNumber, item.licenseNumber, item.phone].some((value) => fold(value).includes(needle)));
    const filtered = searched.filter((item) =>
      (params.status === undefined || item.status === params.status) &&
      (params.account === undefined || (params.account === 'linked') === linkedIds.has(item.id)));
    const pageSize = Number(params.pageSize ?? 20);
    const start = (Number(params.page ?? 1) - 1) * pageSize;
    const count = (predicate: (item: Driver) => boolean) => searched.filter(predicate).length;
    return {
      data: filtered.slice(start, start + pageSize),
      meta: {
        page: Number(params.page ?? 1), pageSize, total: filtered.length,
        counts: {
          status: { active: count((item) => item.status === 'active'), inactive: count((item) => item.status === 'inactive') },
          account: { linked: count((item) => linkedIds.has(item.id)), unlinked: count((item) => !linkedIds.has(item.id)) },
        },
      },
    };
  };
}

function buildClient(crew: readonly Driver[] = [driver], linkedIds?: ReadonlySet<string>) {
  return {
    listDriversPage: vi.fn().mockImplementation(crewPage(crew, linkedIds)),
    listDriverAccounts: vi.fn().mockResolvedValue([account]),
    createDriver: vi.fn().mockResolvedValue({ ...driver, id: 'driver-2', fullName: 'Luis Paredes' }),
    updateDriver: vi.fn().mockResolvedValue({ ...driver, phone: '+51 900 111 222' }),
    bindDriverAccount: vi.fn().mockResolvedValue({ driverId: driver.id, userId: account.userId }),
    getDriverRouteStats: vi.fn().mockImplementation(async () => [trips]),
  } satisfies Pick<ApiClient, 'listDriversPage' | 'listDriverAccounts' | 'createDriver' | 'updateDriver' | 'bindDriverAccount'
    | 'getDriverRouteStats'>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DriverManagementPage', () => {
  it('lists driver details and registers a driver through the catalog API', async () => {
    const user = setupUser();
    const client = buildClient();
    render(<DriverManagementPage client={client} canBindAccounts />);

    const row = await screen.findByRole('listitem', { name: /Valeria Gomez/ });
    expect(within(row).getByText('DNI-123456')).toBeTruthy();
    expect(within(row).getByText('A-123456')).toBeTruthy();
    expect(screen.getByText('1 de 1 conductores activos · 0 con cuenta vinculada.')).toBeTruthy();
    client.listDriversPage.mockImplementation(crewPage([driver, { ...driver, id: 'driver-2', fullName: 'Luis Paredes' }]));

    await user.click(screen.getByRole('button', { name: 'Registrar conductor' }));
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
    const user = setupUser();
    const client = buildClient();
    render(<DriverManagementPage client={client} canBindAccounts />);

    const row = await screen.findByRole('listitem', { name: /Valeria Gomez/ });
    await user.click(within(row).getByRole('button', { name: 'Editar a Valeria Gomez' }));
    const sheet = screen.getByRole('dialog', { name: 'Editar Valeria Gomez' });
    expect(within(sheet).queryByLabelText('Documento de identidad')).toBeNull();
    const phone = within(sheet).getByLabelText('Teléfono');
    await user.clear(phone);
    await user.type(phone, '+51 900 111 222');
    await user.click(within(sheet).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(client.updateDriver).toHaveBeenCalledWith(driver.id, {
      fullName: driver.fullName, phone: '+51 900 111 222', licenseNumber: driver.licenseNumber,
      status: driver.status,
    }));
    expect(within(row).getByText('DNI-123456')).toBeTruthy();
  });

  it('lets an ADMIN link and unlink only an active account that is available or already assigned here', async () => {
    const user = setupUser();
    const client = buildClient();
    client.listDriverAccounts
      .mockResolvedValueOnce([account])
      .mockResolvedValue([{ ...account, driverId: driver.id }]);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    render(<DriverManagementPage client={client} canBindAccounts />);

    const row = await screen.findByRole('listitem', { name: /Valeria Gomez/ });
    await user.click(within(row).getByRole('button', { name: 'Vincular cuenta de Valeria Gomez' }));
    await chooseOption(user, screen.getByLabelText('Cuenta para Valeria Gomez'), account.email);
    await user.click(screen.getByRole('button', { name: 'Vincular cuenta' }));
    await waitFor(() => expect(client.bindDriverAccount).toHaveBeenCalledWith(driver.id, account.userId));
    expect(await within(row).findByText('valeria@example.test')).toBeTruthy();

    await user.click(within(row).getByRole('button', { name: 'Cuenta de Valeria Gomez' }));
    await user.click(await screen.findByRole('button', { name: 'Desvincular cuenta' }));
    await waitFor(() => expect(client.bindDriverAccount).toHaveBeenLastCalledWith(driver.id, null));
  });

  it('requires confirmation before linking an account', async () => {
    const user = setupUser();
    const client = buildClient();
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    render(<DriverManagementPage client={client} canBindAccounts />);

    const row = await screen.findByRole('listitem', { name: /Valeria Gomez/ });
    await user.click(within(row).getByRole('button', { name: 'Vincular cuenta de Valeria Gomez' }));
    await chooseOption(user, screen.getByLabelText('Cuenta para Valeria Gomez'), account.email);
    await user.click(screen.getByRole('button', { name: 'Vincular cuenta' }));

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

  it('filters drivers by status and account, and searches ignoring accents, on the server', async () => {
    const user = setupUser();
    const inactive: Driver = { ...driver, id: 'driver-2', fullName: 'Luis Peña', documentNumber: 'DNI-999999', status: 'inactive' };
    const client = buildClient([driver, inactive], new Set([driver.id]));
    client.listDriverAccounts.mockResolvedValue([{ ...account, driverId: driver.id }]);
    render(<DriverManagementPage client={client} canBindAccounts />);

    await screen.findByRole('listitem', { name: /Valeria Gomez/ });
    expect(screen.getByText('1 de 2 conductores activos · 1 con cuenta vinculada.')).toBeTruthy();
    const chips = screen.getByRole('group', { name: 'Filtrar conductores' });
    expect(within(chips).getByRole('button', { name: /Sin cuenta/ }).textContent).toContain('1');
    await user.click(within(chips).getByRole('button', { name: /Inactivos/ }));
    await waitFor(() => expect(client.listDriversPage).toHaveBeenLastCalledWith(
      { status: 'inactive', page: 1, pageSize: 12 }, expect.any(AbortSignal)));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: /Valeria Gomez/ })).toBeNull());
    expect(screen.getByRole('listitem', { name: /Luis Peña/ })).toBeTruthy();

    await user.click(within(chips).getByRole('button', { name: /Sin cuenta/ }));
    await waitFor(() => expect(client.listDriversPage).toHaveBeenLastCalledWith(
      { account: 'unlinked', page: 1, pageSize: 12 }, expect.any(AbortSignal)));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('listitem', { name: /Luis Peña/ })).toBeTruthy();

    await user.click(within(chips).getByRole('button', { name: /Todos/ }));
    await user.type(screen.getByLabelText('Buscar conductores'), 'pena');
    await waitFor(() => expect(client.listDriversPage).toHaveBeenLastCalledWith(
      { page: 1, pageSize: 12, q: 'pena' }, expect.any(AbortSignal)));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByRole('listitem', { name: /Luis Peña/ })).toBeTruthy();
    expect(screen.getByText('1 de 2 conductores activos · 1 con cuenta vinculada.')).toBeTruthy();

    await user.clear(screen.getByLabelText('Buscar conductores'));
    await user.type(screen.getByLabelText('Buscar conductores'), 'zzz');
    expect(await screen.findByText('Ningún conductor coincide')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Ver todos' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
  });

  it('pages the crew on the server', async () => {
    const user = setupUser();
    const crew = Array.from({ length: 14 }, (_, index): Driver => ({
      ...driver, id: `driver-${index + 1}`, fullName: `Conductor ${String(index + 1).padStart(2, '0')}`,
    }));
    const client = buildClient(crew);
    render(<DriverManagementPage client={client} canBindAccounts={false} />);

    await screen.findByRole('listitem', { name: /Conductor 01/ });
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    await user.click(screen.getByRole('button', { name: 'Página siguiente de conductores' }));
    expect(await screen.findByRole('listitem', { name: /Conductor 14/ })).toBeTruthy();
    expect(screen.getByText('Página 2 de 2')).toBeTruthy();
  });

  it('shows the trips of each visible driver and scopes them to the chosen period without reloading the list', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T15:00:00.000Z'));
    const user = setupUser();
    const idle: Driver = { ...driver, id: 'driver-2', fullName: 'Luis Peña', documentNumber: 'DNI-999999' };
    const client = buildClient([driver, idle]);
    render(<DriverManagementPage client={client} canBindAccounts={false} />);

    const card = await screen.findByRole('listitem', { name: /Valeria Gomez/ });
    await waitFor(() => expect(within(card).getByText('Viajes').nextElementSibling?.textContent).toBe('12'));
    expect(within(card).getByText('Completados').nextElementSibling?.textContent).toBe('9');
    expect(within(card).getByText('Último viaje').nextElementSibling?.textContent).toBe('14 nov. 2026');
    const idleCard = screen.getByRole('listitem', { name: /Luis Peña/ });
    expect(within(idleCard).getByText('Viajes').nextElementSibling?.textContent).toBe('0');
    expect(within(idleCard).getByText('Último viaje').nextElementSibling?.textContent).toBe('Sin viajes');
    expect(client.getDriverRouteStats).toHaveBeenCalledWith({ ids: [driver.id, idle.id] });
    expect(screen.getByText('Viajes de todo el historial')).toBeTruthy();
    const listCalls = client.listDriversPage.mock.calls.length;

    await chooseOption(user, screen.getByLabelText('Periodo de las métricas'), 'Últimos 3 meses');

    await waitFor(() => expect(client.getDriverRouteStats).toHaveBeenLastCalledWith({
      from: '2026-09-01', to: '2026-11-30', ids: [driver.id, idle.id],
    }));
    expect(await screen.findByText('Viajes de últimos 3 meses')).toBeTruthy();
    expect(client.listDriversPage.mock.calls.length).toBe(listCalls);
    vi.useRealTimers();
  });

  it('keeps the crew visible with dashes when the trips cannot be loaded', async () => {
    const client = buildClient();
    client.getDriverRouteStats.mockRejectedValue(new Error('offline'));
    render(<DriverManagementPage client={client} canBindAccounts={false} />);

    const card = await screen.findByRole('listitem', { name: /Valeria Gomez/ });
    await waitFor(() => expect(within(card).getByText('Viajes').nextElementSibling?.textContent).toBe('—'));
    expect(within(card).getByText('Último viaje').nextElementSibling?.textContent).toBe('—');
  });
});
