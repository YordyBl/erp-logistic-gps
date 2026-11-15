/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chooseOption, setupUser } from '../test/ui.js';

import type { ApiClient, Customer, Page } from '../api/client.js';
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

/** Una página del servidor con los conteos por estado de esas filas. */
function pageOf(customers: readonly Customer[], counts?: { active: number; inactive: number }): Page<Customer> {
  const status = counts ?? {
    active: customers.filter((customer) => customer.status === 'active').length,
    inactive: customers.filter((customer) => customer.status === 'inactive').length,
  };
  return { data: customers, meta: { page: 1, pageSize: 10, total: customers.length, counts: { status } } };
}

function makeClient(overrides: Partial<Pick<ApiClient, 'listCustomersPage' | 'createCustomer'>> = {}) {
  return {
    listCustomersPage: vi.fn().mockResolvedValue(pageOf([firstCustomer])),
    createCustomer: vi.fn().mockResolvedValue(newCustomer),
    ...overrides,
  } satisfies Pick<ApiClient, 'listCustomersPage' | 'createCustomer'>;
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
    expect(client.listCustomersPage).toHaveBeenCalledOnce();
    expect(client.listCustomersPage).toHaveBeenCalledWith({ page: 1, pageSize: 10, sort: 'name:asc' }, expect.any(AbortSignal));
    expect(screen.queryByRole('button', { name: /editar|eliminar|borrar/i })).toBeNull();
  });

  it('takes the active share of the catalog from the server counts', async () => {
    const client = makeClient({ listCustomersPage: vi.fn().mockResolvedValue(pageOf([firstCustomer], { active: 7, inactive: 5 })) });

    render(<CustomerCatalogPage client={client} />);

    expect(await screen.findByText('Empresas que contratan el servicio · 7 de 12 activas.')).toBeTruthy();
  });

  it('sends search, status filter and sort as page parameters', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<CustomerCatalogPage client={client} />);
    await screen.findByText('ACME-01');

    await user.type(screen.getByPlaceholderText('Buscar empresa, código o contacto'), 'acme');
    await waitFor(() => expect(client.listCustomersPage).toHaveBeenLastCalledWith(
      { page: 1, pageSize: 10, q: 'acme', sort: 'name:asc' }, expect.any(AbortSignal)));

    await user.click(screen.getByRole('button', { name: 'Estado' }));
    await user.click(await screen.findByRole('option', { name: /Inactivo/ }));
    await waitFor(() => expect(client.listCustomersPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'inactive', q: 'acme' }), expect.any(AbortSignal)));
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: /Empresa/ }));
    await waitFor(() => expect(client.listCustomersPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'name:desc' }), expect.any(AbortSignal)));
    // Contacto y estado no se pueden ordenar en el servidor.
    expect(screen.queryByRole('button', { name: /^Contacto/ })).toBeNull();
  });

  it('shows loading feedback and lets the operator retry after a list error', async () => {
    const user = setupUser();
    const listCustomersPage = vi.fn()
      .mockRejectedValueOnce(new Error('Sin conexión'))
      .mockResolvedValueOnce(pageOf([firstCustomer]));

    render(<CustomerCatalogPage client={makeClient({ listCustomersPage })} />);

    expect(screen.getByText('Cargando clientes…')).toBeTruthy();
    expect(await screen.findByText('No se pudo cargar el catálogo. Revisa la conexión e inténtalo de nuevo.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('ACME-01')).toBeTruthy();
    expect(listCustomersPage).toHaveBeenCalledTimes(2);
  });

  it('explains an empty catalog and opens the inline creation form', async () => {
    const user = setupUser();

    render(<CustomerCatalogPage client={makeClient({ listCustomersPage: vi.fn().mockResolvedValue(pageOf([])) })} />);

    expect(await screen.findByText('Todavía no hay clientes')).toBeTruthy();
    expect(screen.getByText('Registra la primera empresa para asociarla a sus pedidos de entrega.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Registrar cliente' }));

    expect(screen.getByRole('form', { name: 'Nuevo cliente' })).toBeTruthy();
    expect(screen.getByLabelText('Código del cliente')).toBeTruthy();
  });

  it('submits exactly the customer API fields, reports success, and reloads the page from the server', async () => {
    const user = setupUser();
    const client = makeClient({
      listCustomersPage: vi.fn().mockResolvedValueOnce(pageOf([firstCustomer]))
        .mockResolvedValue(pageOf([firstCustomer, newCustomer])),
    });

    render(<CustomerCatalogPage client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Nuevo cliente' }));
    await user.type(screen.getByLabelText('Código del cliente'), 'NORTE-02');
    await user.type(screen.getByLabelText('Razón social'), 'Distribuidora Norte');
    await user.type(screen.getByLabelText('Nombre de contacto'), 'Mario Salas');
    await user.type(screen.getByLabelText('Correo de contacto'), 'mario@norte.example');
    await user.type(screen.getByLabelText('Teléfono de contacto'), '01 555 1234');
    await chooseOption(user, screen.getByLabelText('Estado'), 'Inactivo');
    await user.click(screen.getByRole('button', { name: 'Guardar cliente' }));

    await waitFor(() => expect(client.createCustomer).toHaveBeenCalledWith({
      publicCode: 'NORTE-02',
      name: 'Distribuidora Norte',
      contactName: 'Mario Salas',
      contactEmail: 'mario@norte.example',
      contactPhone: '01 555 1234',
      status: 'inactive',
    }));
    expect(await screen.findByText('El cliente «Distribuidora Norte» se registró correctamente.')).toBeTruthy();
    expect(await screen.findByText('Distribuidora Norte')).toBeTruthy();
    expect(screen.getByText('Inactivo')).toBeTruthy();
    expect(client.listCustomersPage).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Empresas que contratan el servicio · 1 de 2 activas.')).toBeTruthy();
  });

  it('keeps the form open and gives actionable feedback when creation fails', async () => {
    const user = setupUser();
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
    expect(client.listCustomersPage).toHaveBeenCalledOnce();
  });
});
