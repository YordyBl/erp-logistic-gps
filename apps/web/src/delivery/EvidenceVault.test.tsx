/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EvidenceVaultItem, Page, PageParams } from '../api/client.js';
import { setupUser } from '../test/ui.js';
import { EvidenceVault, VAULT_PAGE_SIZE } from './EvidenceVault.js';

function item(index: number, overrides: Partial<EvidenceVaultItem> = {}): EvidenceVaultItem {
  return {
    id: `evidence-${index}`,
    orderId: `order-${index}`,
    attemptId: `attempt-${index}`,
    incidentId: null,
    mimeType: 'image/jpeg',
    byteSize: 1000,
    checksum: 'a'.repeat(64),
    uploadedBy: 'driver-user',
    status: 'available',
    createdAt: '2026-11-02T10:00:00.000Z',
    availableAt: '2026-11-02T10:00:00.000Z',
    order: { id: `order-${index}`, publicCode: `LIM-${index}`, status: 'delivered', recipientName: `Cliente ${index}`, district: 'Lince' },
    ...overrides,
  };
}

function pageOf(items: readonly EvidenceVaultItem[], page = 1, total = items.length): Page<EvidenceVaultItem> {
  return { data: items, meta: { page, pageSize: VAULT_PAGE_SIZE, total } };
}

function makeClient(listEvidencePage: (params: PageParams, signal?: AbortSignal) => Promise<Page<EvidenceVaultItem>>) {
  return {
    listEvidencePage: vi.fn(listEvidencePage),
    downloadEvidence: vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' })),
  };
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:evidence');
  URL.revokeObjectURL = vi.fn();
});

afterEach(cleanup);

describe('EvidenceVault', () => {
  it('loads a single server page and renders it in the server order', async () => {
    const first = Array.from({ length: VAULT_PAGE_SIZE }, (_, index) => item(index + 1));
    const client = makeClient(async () => pageOf(first, 1, 10));
    render(<EvidenceVault client={client} onPreview={vi.fn()} />);

    expect(await screen.findByText('LIM-1')).toBeTruthy();
    expect(client.listEvidencePage).toHaveBeenCalledOnce();
    expect(client.listEvidencePage).toHaveBeenCalledWith({ page: 1, pageSize: VAULT_PAGE_SIZE }, expect.any(AbortSignal));
    const codes = screen.getAllByText(/^LIM-\d+$/).map((node) => node.textContent);
    expect(codes).toEqual(first.map((value) => value.order.publicCode));
    expect(screen.getByText(/Cliente 1, Lince/)).toBeTruthy();
    expect(screen.getByText('Página 1 de 2')).toBeTruthy();
  });

  it('asks the server for the next page instead of slicing locally', async () => {
    const user = setupUser();
    const first = Array.from({ length: VAULT_PAGE_SIZE }, (_, index) => item(index + 1));
    const client = makeClient(async (params) => (params.page === 2
      ? pageOf([item(9), item(10, { incidentId: 'incident-1' })], 2, 10)
      : pageOf(first, 1, 10)));
    render(<EvidenceVault client={client} onPreview={vi.fn()} />);
    await screen.findByText('LIM-1');

    await user.click(screen.getByRole('button', { name: 'Fotos siguientes' }));

    expect(await screen.findByText('LIM-10')).toBeTruthy();
    expect(screen.queryByText('LIM-1')).toBeNull();
    expect(screen.getByText('Incidencia')).toBeTruthy();
    expect(screen.getByText('Página 2 de 2')).toBeTruthy();
    expect(client.listEvidencePage).toHaveBeenLastCalledWith({ page: 2, pageSize: VAULT_PAGE_SIZE }, expect.any(AbortSignal));
    expect(client.listEvidencePage).toHaveBeenCalledTimes(2);
    expect((screen.getByRole('button', { name: 'Fotos siguientes' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens the preview with the evidence of the card', async () => {
    const user = setupUser();
    const onPreview = vi.fn();
    const client = makeClient(async () => pageOf([item(1)]));
    render(<EvidenceVault client={client} onPreview={onPreview} />);

    await user.click(await screen.findByRole('button', { name: 'Ver foto de LIM-1' }));

    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'evidence-1', mimeType: 'image/jpeg' }));
    expect(screen.queryByText(/Página/)).toBeNull();
  });

  it('shows the empty state when the organization has no photos', async () => {
    const client = makeClient(async () => pageOf([]));
    render(<EvidenceVault client={client} onPreview={vi.fn()} />);

    expect(await screen.findByText('Aún no hay fotos guardadas')).toBeTruthy();
  });

  it('reports a failed load', async () => {
    const client = makeClient(async () => { throw new Error('offline'); });
    render(<EvidenceVault client={client} onPreview={vi.fn()} />);

    expect(await screen.findByText(/No se pudo cargar la bóveda/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText('Cargando bóveda')).toBeNull());
  });
});
