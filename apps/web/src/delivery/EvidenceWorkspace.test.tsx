/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, type DeliveryOrder } from '../api/client.js';
import { setupUser } from '../test/ui.js';
import { EvidenceWorkspace } from './EvidenceWorkspace.js';

const order = {
  id: 'order-1', publicCode: 'LIM-2041', status: 'delivered',
  recipient: { name: 'María Pérez', phone: '900 000 111' },
  deliveryAddress: { addressLine: 'Av. Arequipa 123', district: 'Lince', latitude: null, longitude: null },
} as DeliveryOrder;

function makeClient(overrides: Partial<{ findOrderByPublicCode: (code: string) => Promise<DeliveryOrder> }> = {}) {
  return {
    findOrderByPublicCode: vi.fn<(code: string) => Promise<DeliveryOrder>>().mockResolvedValue(order),
    listEvidence: vi.fn().mockResolvedValue([]),
    downloadEvidence: vi.fn().mockResolvedValue(new Blob()),
    listDeliveryOrders: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

afterEach(cleanup);

describe('EvidenceWorkspace search', () => {
  it('waits until typing stops and searches once, without a submit button', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<EvidenceWorkspace client={client} />);

    expect(screen.queryByRole('button', { name: /Buscar pedido/ })).toBeNull();
    await user.type(screen.getByLabelText('Código del pedido'), 'LIM-2041');
    expect(client.findOrderByPublicCode).not.toHaveBeenCalled();

    expect(await screen.findByText('María Pérez')).toBeTruthy();
    expect(client.findOrderByPublicCode).toHaveBeenCalledOnce();
    expect(client.findOrderByPublicCode).toHaveBeenCalledWith('LIM-2041');
  });

  it('reports an unknown code without treating it as a failure', async () => {
    const user = setupUser();
    const client = makeClient({ findOrderByPublicCode: vi.fn().mockRejectedValue(new ApiError('No encontrado', 404, 'NOT_FOUND')) });
    render(<EvidenceWorkspace client={client} />);

    await user.type(screen.getByLabelText('Código del pedido'), 'LIM-9');

    expect(await screen.findByText(/Ningún pedido tiene el código/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows connection failures as errors', async () => {
    const user = setupUser();
    const client = makeClient({ findOrderByPublicCode: vi.fn().mockRejectedValue(new Error('offline')) });
    render(<EvidenceWorkspace client={client} />);

    await user.type(screen.getByLabelText('Código del pedido'), 'LIM-2041');

    expect(await screen.findByText(/No se pudo consultar la evidencia/)).toBeTruthy();
  });

  it('clears the result when the search is emptied', async () => {
    const user = setupUser();
    render(<EvidenceWorkspace client={makeClient()} />);

    await user.type(screen.getByLabelText('Código del pedido'), 'LIM-2041');
    await screen.findByText('María Pérez');
    await user.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));

    await waitFor(() => expect(screen.queryByText('María Pérez')).toBeNull());
  });

  it('ignores a slow answer that arrives after a newer search', async () => {
    const user = setupUser();
    let finishFirst!: (value: DeliveryOrder) => void;
    const second = { ...order, id: 'order-2', recipient: { ...order.recipient, name: 'Luis Soto' } };
    const client = makeClient({
      findOrderByPublicCode: vi.fn()
        .mockReturnValueOnce(new Promise<DeliveryOrder>((resolve) => { finishFirst = resolve; }))
        .mockResolvedValueOnce(second),
    });
    render(<EvidenceWorkspace client={client} />);

    await user.type(screen.getByLabelText('Código del pedido'), 'LIM-1');
    await waitFor(() => expect(client.findOrderByPublicCode).toHaveBeenCalledOnce());
    await user.type(screen.getByLabelText('Código del pedido'), '2');
    expect(await screen.findByText('Luis Soto')).toBeTruthy();

    finishFirst(order);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(screen.queryByText('María Pérez')).toBeNull();
  });
});
