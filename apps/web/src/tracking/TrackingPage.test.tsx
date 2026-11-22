/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { fetchPublicTracking } from './mockTrackingApi.js';
import { readTrackingKey, TrackingPage } from './TrackingPage.js';

afterEach(cleanup);

describe('public tracking page', () => {
  it('reads the link key from the fragment, never from the path', () => {
    expect(readTrackingKey('#k=demo-camino')).toBe('demo-camino');
    expect(readTrackingKey('')).toBe('');
  });

  it('shows the company brand and how many stops are left while the order is on its way', async () => {
    render(<TrackingPage trackingKey="demo-camino" load={fetchPublicTracking} />);

    expect(await screen.findByRole('heading', { name: 'Tu pedido está en camino' })).toBeTruthy();
    expect(screen.getByText('Courier Express')).toBeTruthy();
    expect(screen.getByText('María está a 2 paradas de ti')).toBeTruthy();
    // One contact link per layout (header on desktop, bottom on phones); CSS shows only one.
    for (const link of screen.getAllByRole('link', { name: /Escribir a Courier Express/ })) {
      expect(link.getAttribute('href')).toBe('https://wa.me/51900000123');
    }
  });

  it('hides the driver position while they hand over another order', async () => {
    render(<TrackingPage trackingKey="demo-otra-parada" load={fetchPublicTracking} />);

    expect(await screen.findByRole('img', { name: /está entregando otro pedido; su posición no se muestra/ })).toBeTruthy();
    expect(screen.queryByText(/Última posición/)).toBeNull();
  });

  it('shows the delivery photo of this order once delivered', async () => {
    render(<TrackingPage trackingKey="demo-entregado" load={fetchPublicTracking} />);

    expect(await screen.findByRole('heading', { name: 'Entregado' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Foto de la entrega en la puerta' })).toBeTruthy();
  });

  it('answers the same for unknown, expired or revoked links, without any company data', async () => {
    render(<TrackingPage trackingKey="no-existe" load={fetchPublicTracking} />);

    expect(await screen.findByRole('heading', { name: 'Este enlace ya no está disponible' })).toBeTruthy();
    expect(screen.queryByText('Courier Express')).toBeNull();
  });
});
