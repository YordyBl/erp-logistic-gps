// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DispatchDashboardPage } from './DispatchDashboardPage.js';

const summary = {
  ordersAwaitingPlanning: 3,
  routesInProgress: 2,
  deliveriesToday: 4,
  incidentsToday: 1,
  orderStatusCounts: {
    created: 2, planned: 1, assigned: 2, in_transit: 3, delivered: 4, returned: 1, cancelled: 0,
  },
  recentOrders: [{ id: 'order-1', publicCode: 'LIM-001', status: 'in_transit' as const,
    createdAt: '2026-11-02T12:00:00.000Z' }],
  recentIncidents: [{ id: 'incident-1', orderId: 'order-2', publicCode: 'LIM-002',
    category: 'recipient_absent', description: 'No había nadie.', occurredAt: '2026-11-02T13:00:00.000Z' }],
  activeRoutes: [{ id: 'route-1', publicCode: 'R-001', plannedDate: '2026-11-02',
    lastPosition: { latitude: -12.05, longitude: -77.04, receivedAt: '2026-11-02T13:30:00.000Z' } }],
};

describe('DispatchDashboardPage', () => {
  afterEach(() => cleanup());

  it('shows operational KPIs, order states, and recent activity from the API', async () => {
    const client = { getDispatchDashboardSummary: vi.fn().mockResolvedValue(summary) };
    render(<DispatchDashboardPage client={client} onOpenOrders={vi.fn()} onOpenDispatch={vi.fn()} onOpenControlTower={vi.fn()} />);

    expect(await screen.findByText('LIM-001')).toBeTruthy();
    expect(screen.getByText('Por planificar')).toBeTruthy();
    expect(screen.getByText('Rutas en curso')).toBeTruthy();
    expect(screen.getByText('Entregas de hoy')).toBeTruthy();
    expect(screen.getByText('Incidencias de hoy')).toBeTruthy();
    expect(screen.getByText('No había nadie.')).toBeTruthy();
    expect(screen.getByText('R-001')).toBeTruthy();
    expect(screen.getByText('-12.05000, -77.04000')).toBeTruthy();
    expect(screen.getAllByText('En tránsito')).toHaveLength(2);
    expect(client.getDispatchDashboardSummary).toHaveBeenCalledOnce();
  });

  it('provides shortcuts to orders, dispatch, and the control tower', async () => {
    const onOpenOrders = vi.fn();
    const onOpenDispatch = vi.fn();
    const onOpenControlTower = vi.fn();
    render(<DispatchDashboardPage client={{ getDispatchDashboardSummary: vi.fn().mockResolvedValue(summary) }}
      onOpenOrders={onOpenOrders} onOpenDispatch={onOpenDispatch} onOpenControlTower={onOpenControlTower} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Ver pedidos' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Ver pedidos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir despacho' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir torre de control' }));

    expect(onOpenOrders).toHaveBeenCalledOnce();
    expect(onOpenDispatch).toHaveBeenCalledOnce();
    expect(onOpenControlTower).toHaveBeenCalledOnce();
  });
});
