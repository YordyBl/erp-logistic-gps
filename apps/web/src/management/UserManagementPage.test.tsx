/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, type Driver, type UserAccount } from '../api/client.js';
import { chooseOption, chooseRowAction, setupUser } from '../test/ui.js';
import { generateTemporaryPassword, UserManagementPage, type UserManagementClient } from './UserManagementPage.js';

const ADMIN: UserAccount = {
  id: 'user-admin', organizationId: 'org-1', email: 'admin@demo.lima', role: 'ADMIN', status: 'active',
  createdAt: '2026-11-01T12:00:00.000Z', firstName: 'Carla', paternalSurname: 'Benites', maternalSurname: 'Rojas',
  lastLoginAt: new Date(Date.now() - 5 * 60_000).toISOString(), driver: null,
};
const DISPATCHER: UserAccount = {
  ...ADMIN, id: 'user-dispatcher', email: 'dispatcher@demo.lima', role: 'DISPATCHER',
  firstName: 'Óscar', paternalSurname: 'Ramírez', maternalSurname: null, lastLoginAt: null,
};
const DRIVER: UserAccount = {
  ...ADMIN, id: 'user-driver', email: 'driver@demo.lima', role: 'DRIVER',
  firstName: null, paternalSurname: null, maternalSurname: null, lastLoginAt: null, driver: null,
};
const FREE_DRIVER: Driver = {
  id: 'driver-1', organizationId: 'org-1', fullName: 'Jorge Huamán', documentNumber: '40000001', phone: '999000111',
  licenseNumber: 'Q40000001', status: 'active', createdAt: '2026-11-01T12:00:00.000Z', updatedAt: '2026-11-01T12:00:00.000Z',
};

function makeClient(overrides: Partial<UserManagementClient> = {}) {
  const { driver: _driver, ...plain } = DISPATCHER;
  void _driver;
  return {
    listUsers: vi.fn().mockResolvedValue([ADMIN, DISPATCHER, DRIVER]),
    createUser: vi.fn().mockResolvedValue({ ...plain, id: 'user-new', email: 'lucia@demo.lima', firstName: 'Lucía', paternalSurname: 'Vega' }),
    updateUser: vi.fn().mockResolvedValue(plain),
    resetUserPassword: vi.fn().mockResolvedValue(undefined),
    listDrivers: vi.fn().mockResolvedValue([FREE_DRIVER]),
    bindDriverAccount: vi.fn().mockResolvedValue({ driverId: 'driver-1', userId: 'user-driver' }),
    ...overrides,
  } satisfies UserManagementClient;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('UserManagementPage', () => {
  it('lists accounts with role, link, last access and status, and sums them under the title', async () => {
    render(<UserManagementPage client={makeClient()} currentUserId="user-admin" />);

    const table = await screen.findByRole('table', { name: 'Usuarios de la organización' });
    expect(within(table).getByText('Carla Benites Rojas')).toBeTruthy();
    expect(within(table).getByText('Óscar Ramírez')).toBeTruthy();
    // Una cuenta anterior a los nombres muestra su correo y pide completar el nombre.
    expect(within(table).getByText('driver@demo.lima')).toBeTruthy();
    expect(within(table).getByText('Completar nombre')).toBeTruthy();
    expect(within(table).getAllByText('Sin primer ingreso')).toHaveLength(2);
    expect(within(table).getByText('Sin vincular')).toBeTruthy();
    expect(screen.getByText('3 usuarios · 1 administrador · 1 operador · 1 conductor · 2 sin primer ingreso')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Qué puede hacer cada rol' })).toBeTruthy();
  });

  it('creates an account with nombres, apellidos and a temporary password', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<UserManagementPage client={client} currentUserId="user-admin" />);
    await screen.findByRole('table', { name: 'Usuarios de la organización' });

    await user.click(screen.getByRole('button', { name: /Nuevo usuario/ }));
    const form = await screen.findByRole('form', { name: 'Nuevo usuario' });
    await user.type(within(form).getByLabelText('Nombres'), 'Lucía');
    await user.type(within(form).getByLabelText('Apellido paterno'), 'Vega');
    await user.type(within(form).getByLabelText('Correo'), 'lucia@demo.lima');
    await chooseOption(user, within(form).getByLabelText('Rol'), 'Conductor');
    await user.type(within(form).getByLabelText('Contraseña temporal'), 'temporal2026');
    await user.click(within(form).getByRole('button', { name: 'Crear usuario' }));

    await waitFor(() => expect(client.createUser).toHaveBeenCalledWith({
      email: 'lucia@demo.lima', password: 'temporal2026', role: 'DRIVER',
      firstName: 'Lucía', paternalSurname: 'Vega', maternalSurname: null,
    }));
    expect(await screen.findByRole('dialog', { name: 'Usuario creado' })).toBeTruthy();
    expect(client.listUsers).toHaveBeenCalledTimes(2);
  });

  it('asks for the role before creating and explains a duplicate email', async () => {
    const user = setupUser();
    const client = makeClient({
      createUser: vi.fn().mockRejectedValue(new ApiError('Email is already in use', 409, 'IDENTITY_EMAIL_ALREADY_IN_USE')),
    });
    render(<UserManagementPage client={client} currentUserId="user-admin" />);
    await screen.findByRole('table', { name: 'Usuarios de la organización' });

    await user.click(screen.getByRole('button', { name: /Nuevo usuario/ }));
    const form = await screen.findByRole('form', { name: 'Nuevo usuario' });
    await user.type(within(form).getByLabelText('Nombres'), 'Lucía');
    await user.type(within(form).getByLabelText('Apellido paterno'), 'Vega');
    await user.type(within(form).getByLabelText('Correo'), 'admin@demo.lima');
    await user.type(within(form).getByLabelText('Contraseña temporal'), 'temporal2026');
    await user.click(within(form).getByRole('button', { name: 'Crear usuario' }));
    expect(await within(form).findByText('Elige el rol de la cuenta.')).toBeTruthy();
    expect(client.createUser).not.toHaveBeenCalled();

    await chooseOption(user, within(form).getByLabelText('Rol'), 'Operador');
    await user.click(within(form).getByRole('button', { name: 'Crear usuario' }));
    expect(await within(form).findByText('Ya existe una cuenta con ese correo en la organización.')).toBeTruthy();
  });

  it('completes a missing name and keeps the own role locked', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<UserManagementPage client={client} currentUserId="user-admin" />);
    await screen.findByRole('table', { name: 'Usuarios de la organización' });

    await chooseRowAction(user, 'Acciones de driver@demo.lima', 'Editar');
    const form = await screen.findByRole('form', { name: 'Editar usuario' });
    await user.type(within(form).getByLabelText('Nombres'), 'Jorge');
    await user.type(within(form).getByLabelText('Apellido paterno'), 'Huamán');
    await user.type(within(form).getByLabelText('Apellido materno (opcional)'), 'Quispe');
    await user.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(client.updateUser).toHaveBeenCalledWith('user-driver', {
      firstName: 'Jorge', paternalSurname: 'Huamán', maternalSurname: 'Quispe',
    }));

    await chooseRowAction(user, 'Acciones de Carla Benites Rojas', 'Editar');
    const own = await screen.findByRole('form', { name: 'Editar usuario' });
    expect(within(own).getByLabelText('Rol').hasAttribute('disabled')).toBe(true);
    expect(within(own).getByText('No puedes cambiar tu propio rol; pídeselo a otro administrador.')).toBeTruthy();
  });

  it('never offers to disable the own account and confirms disabling another one', async () => {
    const user = setupUser();
    const client = makeClient();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<UserManagementPage client={client} currentUserId="user-admin" />);
    await screen.findByRole('table', { name: 'Usuarios de la organización' });

    await user.click(screen.getByRole('button', { name: 'Acciones de Carla Benites Rojas' }));
    expect(screen.queryByRole('menuitem', { name: /Desactivar/ })).toBeNull();
    await user.keyboard('{Escape}');

    await chooseRowAction(user, 'Acciones de Óscar Ramírez', /Desactivar/);
    expect(confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(client.updateUser).toHaveBeenCalledWith('user-dispatcher', { status: 'disabled' }));
    expect(await screen.findByText('La cuenta de Óscar Ramírez quedó desactivada.')).toBeTruthy();
  });

  it('sets a temporary password and links a driver account', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<UserManagementPage client={client} currentUserId="user-admin" />);
    await screen.findByRole('table', { name: 'Usuarios de la organización' });

    await chooseRowAction(user, 'Acciones de Óscar Ramírez', 'Restablecer contraseña');
    const reset = await screen.findByRole('form', { name: 'Restablecer contraseña' });
    await user.type(within(reset).getByLabelText('Contraseña temporal'), 'nueva-clave-26');
    await user.click(within(reset).getByRole('button', { name: 'Cambiar contraseña' }));
    await waitFor(() => expect(client.resetUserPassword).toHaveBeenCalledWith('user-dispatcher', 'nueva-clave-26'));

    await chooseRowAction(user, 'Acciones de driver@demo.lima', 'Vincular conductor');
    const link = await screen.findByRole('form', { name: 'Vincular conductor' });
    await chooseOption(user, await within(link).findByLabelText('Conductor'), 'Jorge Huamán');
    await user.click(within(link).getByRole('button', { name: 'Guardar vínculo' }));
    await waitFor(() => expect(client.bindDriverAccount).toHaveBeenCalledWith('driver-1', 'user-driver'));
    expect(await screen.findByText('La cuenta de driver@demo.lima quedó vinculada a Jorge Huamán.')).toBeTruthy();
  });

  it('offers a retry when the list cannot load', async () => {
    const user = setupUser();
    const client = makeClient({ listUsers: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([ADMIN]) });
    render(<UserManagementPage client={client} currentUserId="user-admin" />);

    await user.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Carla Benites Rojas')).toBeTruthy();
  });
});

describe('generateTemporaryPassword', () => {
  it('meets the API policy: twelve characters with letters and digits', () => {
    const password = generateTemporaryPassword((size) => Uint32Array.from({ length: size }, (_, index) => index * 7));
    expect(password).toHaveLength(12);
    expect(password).toMatch(/^[a-z]{8}[0-9]{4}$/);
  });
});
