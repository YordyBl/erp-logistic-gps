// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GlobalSearch } from './GlobalSearch.js';

const page = <T,>(data: readonly T[]) => ({ data, meta: { page: 1, pageSize: 5, total: data.length } });

const order = {
  id: 'order-1', publicCode: 'LIM-0144', status: 'in_transit', recipient: { name: 'Librería Ática', phone: '900' },
  deliveryAddress: { addressLine: 'Jr. Bolognesi 455', district: 'Barranco', latitude: null, longitude: null },
};
const route = { id: 'route-1', publicCode: 'R-0408', status: 'in_progress', driverId: 'driver-1', vehicleId: 'vehicle-1', stops: [] };

function searchClient(overrides: Record<string, unknown> = {}) {
  return {
    listDeliveryOrdersPage: vi.fn().mockResolvedValue(page([order])),
    listDispatchRoutesPage: vi.fn().mockResolvedValue(page([route])),
    listCustomersPage: vi.fn().mockResolvedValue(page([{ id: 'customer-1', name: 'Café Barranco', publicCode: 'CLI-7', contactName: 'Eva' }])),
    listDrivers: vi.fn().mockResolvedValue([
      { id: 'driver-1', fullName: 'María Rojas', documentNumber: '45781236', phone: '900000214' },
      { id: 'driver-2', fullName: 'Jorge Huamán', documentNumber: '40000001', phone: '900000215' },
    ]),
    listVehicles: vi.fn().mockResolvedValue([{ id: 'vehicle-1', plate: 'BXK-482', type: 'Furgoneta' }]),
    ...overrides,
  };
}

function renderSearch(client = searchClient()) {
  const onOpen = vi.fn();
  render(<GlobalSearch client={client as never} onOpen={onOpen} />);
  return { client, onOpen };
}

const type = (value: string) => fireEvent.change(screen.getByPlaceholderText(/Buscar pedido, ruta/), { target: { value } });

describe('GlobalSearch', () => {
  afterEach(() => cleanup());

  it('opens with Ctrl K and with ⌘K, and closes with the same shortcut', async () => {
    renderSearch();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByPlaceholderText(/Buscar pedido, ruta/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(screen.queryByPlaceholderText(/Buscar pedido, ruta/)).toBeNull());
    fireEvent.keyDown(window, { key: 'K', metaKey: true });
    expect(await screen.findByPlaceholderText(/Buscar pedido, ruta/)).toBeTruthy();
  });

  it('waits for two letters, then groups server results with drivers and vehicles filtered here', async () => {
    const { client } = renderSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Buscar en ERP Logistic' }));
    type('r');
    expect(screen.getByText('Escribe al menos 2 letras para buscar.')).toBeTruthy();

    type('rojas');
    expect(await screen.findByText('LIM-0144')).toBeTruthy();
    expect(client.listDeliveryOrdersPage).toHaveBeenCalledWith({ q: 'rojas', page: 1, pageSize: 5 }, expect.any(AbortSignal));
    // La ruta muestra conductor y placa sacados de los catálogos.
    expect(screen.getByText('María Rojas · BXK-482')).toBeTruthy();
    expect(screen.getByText('Café Barranco')).toBeTruthy();
    expect(screen.getAllByText('María Rojas')).toHaveLength(1);
    expect(screen.queryByText('Jorge Huamán')).toBeNull();

    // Sin tildes y por placa.
    type('huaman');
    expect(await screen.findByText('Jorge Huamán')).toBeTruthy();
    type('bxk');
    expect(await screen.findByText('Furgoneta')).toBeTruthy();
  });

  it('hands the chosen result to onOpen and closes', async () => {
    const { onOpen } = renderSearch();
    fireEvent.click(screen.getByRole('button', { name: 'Buscar en ERP Logistic' }));
    type('r-04');
    fireEvent.click(await screen.findByText('R-0408'));
    expect(onOpen).toHaveBeenCalledWith({ kind: 'route', publicCode: 'R-0408', inProgress: true });
    await waitFor(() => expect(screen.queryByPlaceholderText(/Buscar pedido, ruta/)).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Buscar en ERP Logistic' }));
    type('lim');
    fireEvent.click(await screen.findByText('LIM-0144'));
    expect(onOpen).toHaveBeenLastCalledWith({ kind: 'order', publicCode: 'LIM-0144' });
  });

  it('keeps the results that arrived and warns when a source fails', async () => {
    renderSearch(searchClient({ listCustomersPage: vi.fn().mockRejectedValue(new Error('caído')) }));
    fireEvent.click(screen.getByRole('button', { name: 'Buscar en ERP Logistic' }));
    type('lim');
    expect(await screen.findByText('LIM-0144')).toBeTruthy();
    expect(screen.getByText('No se pudieron cargar todos los resultados.')).toBeTruthy();
  });

  it('says so when nothing matches', async () => {
    const empty = vi.fn().mockResolvedValue(page([]));
    renderSearch(searchClient({ listDeliveryOrdersPage: empty, listDispatchRoutesPage: empty, listCustomersPage: empty }));
    fireEvent.click(screen.getByRole('button', { name: 'Buscar en ERP Logistic' }));
    type('zzz');
    expect(await screen.findByText('Sin resultados para «zzz».')).toBeTruthy();
  });
});
