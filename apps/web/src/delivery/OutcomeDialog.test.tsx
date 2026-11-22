/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chooseOption, setupUser } from '../test/ui.js';

import { OutcomeDialog } from './OutcomeDialog.js';
import type { ApiClient, DeliveryOrder, DeliveryEvidence } from '../api/client.js';

const order: DeliveryOrder = {
  id: 'order-1',
  organizationId: 'org-1',
  customerId: 'customer-1',
  publicCode: 'LIM-2041',
  timeWindow: 'AM',
  status: 'in_transit',
  recipient: { name: 'María Pérez', phone: '999 000 111' },
  deliveryAddress: {
    addressLine: 'Av. Arequipa 123',
    district: 'Lince',
    latitude: null,
    longitude: null,
  },
  packages: [{ code: 'PKG-01', description: 'Caja mediana', weightKg: null }],
  createdAt: '2026-10-29T12:00:00.000Z',
  updatedAt: '2026-10-29T12:00:00.000Z',
};

const evidence: DeliveryEvidence = {
  id: 'evidence-1',
  orderId: order.id,
  attemptId: 'attempt-1',
  incidentId: null,
  mimeType: 'image/jpeg',
  byteSize: 4,
  checksum: 'checksum',
  uploadedBy: 'driver-1',
  status: 'available',
  createdAt: '2026-10-29T12:00:00.000Z',
  availableAt: '2026-10-29T12:00:01.000Z',
};

afterEach(cleanup);

function client(uploadEvidence: ApiClient['uploadEvidence']): ApiClient {
  return {
    uploadEvidence,
    confirmDelivery: vi.fn().mockResolvedValue(undefined),
    reportIncident: vi.fn().mockResolvedValue(undefined),
  } as unknown as ApiClient;
}

describe('OutcomeDialog', () => {
  it('does not confirm from a local preview; it requires an available uploaded photo', async () => {
    const user = setupUser();
    const uploadEvidence = vi.fn().mockResolvedValue(evidence);
    const api = client(uploadEvidence);
    const onComplete = vi.fn();
    render(<OutcomeDialog order={order} client={api} outcome="delivery" onComplete={onComplete} onClose={vi.fn()} />);

    const confirm = screen.getByRole('button', { name: 'Confirmar entrega' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await user.upload(screen.getByLabelText('Fotos de la entrega'),
      new File([new Uint8Array([1, 2, 3, 4])], 'proof.jpg', { type: 'image/jpeg' }));
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    expect(uploadEvidence).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Guardar fotos' }));
    await waitFor(() => expect(uploadEvidence).toHaveBeenCalledTimes(1));
    expect((confirm as HTMLButtonElement).disabled).toBe(false);

    await user.click(confirm);
    await waitFor(() => expect(api.confirmDelivery).toHaveBeenCalledWith({
      orderId: order.id,
      evidenceIds: [evidence.id],
      receiverName: null,
      notes: null,
    }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('keeps confirmation unavailable when upload fails', async () => {
    const user = setupUser();
    const uploadEvidence = vi.fn().mockRejectedValue(new Error('storage unavailable'));
    const api = client(uploadEvidence);
    render(<OutcomeDialog order={order} client={api} outcome="delivery" onComplete={vi.fn()} onClose={vi.fn()} />);

    await user.upload(screen.getByLabelText('Fotos de la entrega'),
      new File([new Uint8Array([1, 2, 3, 4])], 'proof.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: 'Guardar fotos' }));

    await screen.findByText(/No se pudo guardar la foto/);
    expect(document.body.textContent).toContain('No se pudo guardar la foto');
    expect((screen.getByRole('button', { name: 'Confirmar entrega' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.confirmDelivery).not.toHaveBeenCalled();
  });

  it('retries an incomplete upload with the same idempotency key', async () => {
    const user = setupUser();
    const uploadEvidence = vi.fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(evidence);
    const api = client(uploadEvidence);
    render(<OutcomeDialog order={order} client={api} outcome="delivery" onComplete={vi.fn()} onClose={vi.fn()} />);
    await user.upload(screen.getByLabelText('Fotos de la entrega'),
      new File([new Uint8Array([1, 2, 3, 4])], 'proof.jpg', { type: 'image/jpeg' }));

    await user.click(screen.getByRole('button', { name: 'Guardar fotos' }));
    await screen.findByText(/No se pudo guardar la foto/);
    const firstKey = uploadEvidence.mock.calls[0]?.[2];
    await user.click(screen.getByRole('button', { name: 'Reintentar carga' }));

    await waitFor(() => expect(uploadEvidence).toHaveBeenCalledTimes(2));
    expect(uploadEvidence.mock.calls[1]?.[2]).toBe(firstKey);
    expect((screen.getByRole('button', { name: 'Confirmar entrega' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('records an incident only after its category, description, and photo are ready', async () => {
    const user = setupUser();
    const api = client(vi.fn().mockResolvedValue(evidence));
    render(<OutcomeDialog order={order} client={api} outcome="incident" onComplete={vi.fn()} onClose={vi.fn()} />);

    const report = screen.getByRole('button', { name: 'Registrar incidencia' });
    expect((report as HTMLButtonElement).disabled).toBe(true);
    await chooseOption(user, screen.getByLabelText('Categoría'), 'Destinatario ausente');
    await user.type(screen.getByLabelText('Descripción'), 'No había nadie para recibir el pedido.');
    expect((report as HTMLButtonElement).disabled).toBe(true);

    await user.upload(screen.getByLabelText('Fotos de la incidencia'),
      new File([new Uint8Array([1, 2, 3, 4])], 'door.jpg', { type: 'image/jpeg' }));
    await user.click(screen.getByRole('button', { name: 'Guardar fotos' }));
    await waitFor(() => expect((report as HTMLButtonElement).disabled).toBe(false));
    await user.click(report);

    await waitFor(() => expect(api.reportIncident).toHaveBeenCalledWith({
      orderId: order.id,
      category: 'recipient_absent',
      description: 'No había nadie para recibir el pedido.',
      evidenceIds: [evidence.id],
    }));
  });
});
