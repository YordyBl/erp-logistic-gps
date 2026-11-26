/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';

import type { ApiClient, DeliveryOrder, Page } from '../api/client.js';
import { setupUser } from '../test/ui.js';
import { OrdersPage } from './OrdersPage.js';

const order: DeliveryOrder = {
  id: 'order-1', organizationId: 'org-1', customerId: 'customer-1', publicCode: 'LIM-2041', status: 'in_transit',
  timeWindow: 'AM',
  recipient: { name: 'María Pérez', phone: '999 000 111' },
  deliveryAddress: { addressLine: 'Av. Arequipa 123', district: 'Lince', latitude: null, longitude: null },
  packages: [{ code: 'PKG-01', description: 'Caja mediana', weightKg: null }],
  createdAt: '2026-10-29T12:00:00.000Z', updatedAt: '2026-10-29T12:00:00.000Z',
};

/** Una página con 1 fila pero conteos de toda la organización, como responde el servidor. */
const page: Page<DeliveryOrder> = {
  data: [order],
  meta: {
    page: 1, pageSize: 10, total: 40,
    counts: {
      status: { created: 10, planned: 0, assigned: 0, in_transit: 5, delivered: 20, returned: 3, cancelled: 2 },
      timeWindow: { AM: 25, PM: 15 },
    },
  },
};

function makeClient(overrides: {
  readonly listDeliveryOrdersPage?: Mock<ApiClient['listDeliveryOrdersPage']>;
  readonly findOrderByPublicCode?: Mock<ApiClient['findOrderByPublicCode']>;
} = {}) {
  return {
    listDeliveryOrdersPage: overrides.listDeliveryOrdersPage ?? vi.fn<ApiClient['listDeliveryOrdersPage']>().mockResolvedValue(page),
    findOrderByPublicCode: overrides.findOrderByPublicCode ?? vi.fn<ApiClient['findOrderByPublicCode']>().mockResolvedValue(order),
    listDeliveryOrderStatusHistory: vi.fn<ApiClient['listDeliveryOrderStatusHistory']>().mockResolvedValue([]),
    listEvidence: vi.fn<ApiClient['listEvidence']>().mockResolvedValue([]),
    downloadEvidence: vi.fn<ApiClient['downloadEvidence']>().mockResolvedValue(new Blob()),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('OrdersPage', () => {
  it('takes the header counts and the returned banner from the server counts, not from the page rows', async () => {
    const client = makeClient();
    render(<OrdersPage client={client} selectedCode={null} onSelectOrder={vi.fn()} onManage={vi.fn()} />);

    expect(await screen.findByText('LIM-2041')).toBeTruthy();
    expect(screen.getByText(/5 en reparto · 20 entregados · 3 devueltos, de 40 pedidos\./)).toBeTruthy();
    expect(screen.getByText(/Hay 3 pedidos devueltos/)).toBeTruthy();
    expect(client.listDeliveryOrdersPage).toHaveBeenCalledWith({ page: 1, pageSize: 10 }, expect.any(AbortSignal));
    expect(client.findOrderByPublicCode).not.toHaveBeenCalled();
  });

  it('sends the status facet as a filter and reloads the current page on Actualizar', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<OrdersPage client={client} selectedCode={null} onSelectOrder={vi.fn()} onManage={vi.fn()} />);
    await screen.findByText('LIM-2041');

    await user.click(screen.getByRole('button', { name: /Estado/ }));
    await user.click(await screen.findByRole('option', { name: /Devuelto/ }));
    await waitFor(() => expect(client.listDeliveryOrdersPage).toHaveBeenLastCalledWith(
      { page: 1, pageSize: 10, status: 'returned' }, expect.any(AbortSignal)));
    await user.keyboard('{Escape}');

    const calls = client.listDeliveryOrdersPage.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(client.listDeliveryOrdersPage).toHaveBeenCalledTimes(calls + 1));
  });

  it('fetches a deep-linked order by its code when it is not on the visible page', async () => {
    const other: DeliveryOrder = { ...order, id: 'order-9', publicCode: 'LIM-9999', recipient: { name: 'Luis Soto', phone: '999 222 333' } };
    const client = makeClient({ findOrderByPublicCode: vi.fn<ApiClient['findOrderByPublicCode']>().mockResolvedValue(other) });
    render(<OrdersPage client={client} selectedCode="LIM-9999" onSelectOrder={vi.fn()} onManage={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'LIM-9999' })).toBeTruthy();
    expect(client.findOrderByPublicCode).toHaveBeenCalledWith('LIM-9999');
    expect(screen.getByText('999 222 333')).toBeTruthy();
  });

  it('shows the empty state only when the organization has no orders at all', async () => {
    const empty: Page<DeliveryOrder> = { data: [], meta: { page: 1, pageSize: 10, total: 0, counts: { status: {} } } };
    render(<OrdersPage client={makeClient({ listDeliveryOrdersPage: vi.fn<ApiClient['listDeliveryOrdersPage']>().mockResolvedValue(empty) })}
      selectedCode={null} onSelectOrder={vi.fn()} onManage={vi.fn()} />);

    expect(await screen.findByText('Sin pedidos registrados')).toBeTruthy();
  });
});
