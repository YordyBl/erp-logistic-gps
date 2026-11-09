/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DispatchDashboardSummary } from '../api/client.js';
import { setupUser } from '../test/ui.js';
import { IncidentNotifications } from './IncidentNotifications.js';

const summary: DispatchDashboardSummary = {
  ordersAwaitingPlanning: 0, routesInProgress: 0, deliveriesToday: 0, incidentsToday: 2,
  orderStatusCounts: { created: 0, planned: 0, assigned: 0, in_transit: 0, delivered: 0, returned: 1, cancelled: 0 },
  recentOrders: [], activeRoutes: [],
  recentIncidents: [{ id: 'incident-1', orderId: 'order-1', publicCode: 'LIM-002', category: 'recipient_absent', description: 'No había nadie.', occurredAt: '2026-11-02T13:00:00.000Z' }],
};

function setup(load: () => Promise<DispatchDashboardSummary>) {
  const client = { getDispatchDashboardSummary: vi.fn(load) };
  const onOpenOrder = vi.fn();
  const onOpenDispatch = vi.fn();
  const view = render(<IncidentNotifications client={client} refreshKey="dashboard" onOpenOrder={onOpenOrder} onOpenDispatch={onOpenDispatch} />);
  return { client, onOpenOrder, onOpenDispatch, view, user: setupUser() };
}

afterEach(cleanup);

describe('IncidentNotifications', () => {
  it('announces today\'s incidents and opens the order from the list', async () => {
    const { user, onOpenOrder } = setup(() => Promise.resolve(summary));

    await user.click(await screen.findByRole('button', { name: 'Notificaciones: 2 incidencias hoy' }));
    expect(screen.getByText('Destinatario ausente')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Destinatario ausente/ }));

    expect(onOpenOrder).toHaveBeenCalledWith('LIM-002');
    await waitFor(() => expect(screen.queryByText('No había nadie.')).toBeNull());
  });

  it('links returned orders to dispatch', async () => {
    const { user, onOpenDispatch } = setup(() => Promise.resolve(summary));

    await user.click(await screen.findByRole('button', { name: /Notificaciones: 2/ }));
    await user.click(screen.getByRole('button', { name: /1 pedido devuelto por reprogramar/ }));

    expect(onOpenDispatch).toHaveBeenCalledOnce();
  });

  it('shows a clear state without a count when nothing happened', async () => {
    const { user } = setup(() => Promise.resolve({
      ...summary, incidentsToday: 0, recentIncidents: [],
      orderStatusCounts: { ...summary.orderStatusCounts, returned: 0 },
    }));

    await user.click(await screen.findByRole('button', { name: 'Notificaciones: 0 incidencias hoy' }));
    expect(screen.getByText('Sin incidencias registradas')).toBeTruthy();
  });

  it('does not present a failed load as a clear state and can retry', async () => {
    const load = vi.fn<() => Promise<DispatchDashboardSummary>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(summary);
    const { user } = setup(load);

    await user.click(await screen.findByRole('button', { name: 'Notificaciones' }));
    expect(await screen.findByText('No se pudieron cargar las notificaciones.')).toBeTruthy();
    expect(screen.queryByText('Sin incidencias registradas')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Destinatario ausente')).toBeTruthy();
  });

  it('refreshes when the key changes', async () => {
    const { client, onOpenOrder, onOpenDispatch, view } = setup(() => Promise.resolve(summary));
    await waitFor(() => expect(client.getDispatchDashboardSummary).toHaveBeenCalledOnce());

    view.rerender(<IncidentNotifications client={client} refreshKey="orders" onOpenOrder={onOpenOrder} onOpenDispatch={onOpenDispatch} />);

    await waitFor(() => expect(client.getDispatchDashboardSummary).toHaveBeenCalledTimes(2));
  });
});
