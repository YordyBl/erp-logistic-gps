/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient, Customer } from '../api/client.js';
import { CustomerCatalogPage } from './CustomerCatalogPage.js';

const firstCustomer: Customer = {
  id: 'customer-1', organizationId: 'org-1', publicCode: 'ACME-01', name: 'Acme Logística',
  contactName: 'Lucía Rojas', contactEmail: 'lucia@acme.example', contactPhone: '+51 999 111 222',
  status: 'active', createdAt: '2026-10-30T12:00:00.000Z',
};

const newCustomer: Customer = {
  ...firstCustomer, id: 'customer-2', publicCode: 'NORTE-02', name: 'Distribuidora Norte',
  contactName: 'Mario Salas', contactEmail: 'mario@norte.example', contactPhone: '01 555 1234',
  status: 'inactive',
};

function makeClient(overrides: Partial<Pick<ApiClient, 'listCustomers' | 'createCustomer'>> = {}) {
  return {
    listCustomers: vi.fn().mockResolvedValue([firstCustomer]),
    createCustomer: vi.fn().mockResolvedValue(newCustomer),
    ...overrides,
  } satisfies Pick<ApiClient, 'listCustomers' | 'createCustomer'>;
}

afterEach(cleanup);

describe('CustomerCatalogPage', () => {
  it('loads customer code, contact details, and active state without edit or delete actions', async () => {
    const client = makeClient();

    render(<CustomerCatalogPage client={client} />);

    expect(await screen.findByText('ACME-01')).toBeTruthy();
    expect(screen.getByText('Acme Logística')).toBeTruthy();
    expect(screen.getByText('Lucía Rojas')).toBeTruthy();
    expect(screen.getByText('lucia@acme.example')).toBeTruthy();
    expect(screen.getByText('Activo')).toBeTruthy();
    expect(client.listCustomers).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /editar|eliminar|borrar/i })).toBeNull();
  });

  it('shows loading feedback and lets the operator retry after a list error', async () => {
    const user = userEvent.setup();
    const listCustomers = vi.fn()
      .mockRejectedValueOnce(new Error('Sin conexión'))
      .mockResolvedValueOnce([firstCustomer]);

    render(<CustomerCatalogPage client={makeClient({ listCustomers })} />);

    expect(screen.getByText('Cargando clientes…')).toBeTruthy();
    expect(await screen.findByText('No se pudo cargar el catálogo. Revisa la conexión e inténtalo de nuevo.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('ACME-01')).toBeTruthy();
    expect(listCustomers).toHaveBeenCalledTimes(2);
  });

  it('explains an empty catalog and opens the inline creation form', async () => {
    const user = userEvent.setup();

    render(<CustomerCatalogPage client={makeClient({ listCustomers: vi.fn().mockResolvedValue([]) })} />);

    expect(await screen.findByText('Todavía no hay clientes')).toBeTruthy();
    expect(screen.getByText('Registra la primera empresa para asociarla a sus pedidos de entrega.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));

    expect(screen.getByRole('form', { name: 'Nuevo cliente' })).toBeTruthy();
    expect(screen.getByLabelText('Código del cliente')).toBeTruthy();
  });

  it('submits exactly the customer API fields, reports success, and adds the customer to the list', async () => {
    const user = userEvent.setup();
    const client = makeClient();

    render(<CustomerCatalogPage client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Nuevo cliente' }));
    await user.type(screen.getByLabelText('Código del cliente'), 'NORTE-02');
    await user.type(screen.getByLabelText('Razón social'), 'Distribuidora Norte');
    await user.type(screen.getByLabelText('Nombre de contacto'), 'Mario Salas');
    await user.type(screen.getByLabelText('Correo de contacto'), 'mario@norte.example');
    await user.type(screen.getByLabelText('Teléfono de contacto'), '01 555 1234');
    await user.selectOptions(screen.getByLabelText('Estado'), 'inactive');
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }));

    await waitFor(() => expect(client.createCustomer).toHaveBeenCalledWith({
      publicCode: 'NORTE-02',
      name: 'Distribuidora Norte',
      contactName: 'Mario Salas',
      contactEmail: 'mario@norte.example',
      contactPhone: '01 555 1234',
      status: 'inactive',
    }));
    expect(await screen.findByText('Cliente «Distribuidora Norte» registrado.')).toBeTruthy();
    expect(screen.getByText('Distribuidora Norte')).toBeTruthy();
    expect(screen.getByText('Inactivo')).toBeTruthy();
    expect(client.listCustomers).toHaveBeenCalledOnce();
  });

  it('keeps the form open and gives actionable feedback when creation fails', async () => {
    const user = userEvent.setup();
    const client = makeClient({ createCustomer: vi.fn().mockRejectedValue(new Error('Código duplicado')) });

    render(<CustomerCatalogPage client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Nuevo cliente' }));
    await user.type(screen.getByLabelText('Código del cliente'), 'NORTE-02');
    await user.type(screen.getByLabelText('Razón social'), 'Distribuidora Norte');
    await user.type(screen.getByLabelText('Nombre de contacto'), 'Mario Salas');
    await user.type(screen.getByLabelText('Correo de contacto'), 'mario@norte.example');
    await user.type(screen.getByLabelText('Teléfono de contacto'), '01 555 1234');
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }));

    expect(await screen.findByText('No se pudo registrar el cliente. Verifica los datos e inténtalo de nuevo.')).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Nuevo cliente' })).toBeTruthy();
    expect(screen.getByLabelText('Código del cliente')).toHaveProperty('value', 'NORTE-02');
    expect(client.listCustomers).toHaveBeenCalledOnce();
  });
});
