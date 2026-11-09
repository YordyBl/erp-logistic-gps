// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DispatchDashboardPage } from './DispatchDashboardPage.js';

vi.mock('./dashboard/OperationsMap.js', () => ({
  OperationsMap: ({ routes }: { readonly routes: readonly { readonly stops: readonly unknown[] }[] }) => (
    <div data-testid="operations-map" data-stops={routes.flatMap((route) => route.stops).length} />
  ),
}));

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

const renderPage = (client: Parameters<typeof DispatchDashboardPage>[0]['client']) => render(
  <DispatchDashboardPage client={client} onOpenOrders={vi.fn()} onOpenDispatch={vi.fn()} onOpenControlTower={vi.fn()} />,
);

describe('DispatchDashboardPage', () => {
  afterEach(() => cleanup());

  it('shows operational KPIs, order states, and recent activity from the API', async () => {
    const client = { getDispatchDashboardSummary: vi.fn().mockResolvedValue(summary) };
    renderPage(client);

    expect((await screen.findAllByText('LIM-001')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Tienes 3 pedidos por planificar/)).toBeTruthy();
    expect(screen.getByText('Rutas en curso')).toBeTruthy();
    expect(screen.getByText('Entregas de hoy')).toBeTruthy();
    expect(screen.getByText('Incidencias de hoy')).toBeTruthy();
    expect(screen.getByText('Incidencia · Destinatario ausente')).toBeTruthy();
    expect(screen.getByText('R-001')).toBeTruthy();
    expect(screen.getByText(/Última señal/)).toBeTruthy();
    expect(screen.getAllByText('En reparto')).toHaveLength(2);
    expect(client.getDispatchDashboardSummary).toHaveBeenCalledOnce();
  });

  it('keeps rendering when the planned date comes with a time or is malformed', async () => {
    const activeRoutes = [
      { ...summary.activeRoutes[0]!, id: 'route-iso', publicCode: 'R-ISO', plannedDate: '2026-11-06T00:00:00.000Z' },
      { ...summary.activeRoutes[0]!, id: 'route-bad', publicCode: 'R-BAD', plannedDate: 'sin-fecha' },
    ];
    renderPage({ getDispatchDashboardSummary: vi.fn().mockResolvedValue({ ...summary, activeRoutes }) });

    expect(await screen.findByText('R-ISO')).toBeTruthy();
    expect(screen.getByText(/Planificada para 6 nov/)).toBeTruthy();
    expect(screen.getByText('Planificada para sin-fecha')).toBeTruthy();
  });

  it('provides shortcuts to orders, dispatch, and the control tower', async () => {
    const onOpenOrders = vi.fn();
    const onOpenDispatch = vi.fn();
    const onOpenControlTower = vi.fn();
    render(<DispatchDashboardPage client={{ getDispatchDashboardSummary: vi.fn().mockResolvedValue(summary) }}
      onOpenOrders={onOpenOrders} onOpenDispatch={onOpenDispatch} onOpenControlTower={onOpenControlTower} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Ver pedidos' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Ver pedidos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Planificar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir torre de control' }));

    expect(onOpenOrders).toHaveBeenCalledOnce();
    expect(onOpenDispatch).toHaveBeenCalledOnce();
    expect(onOpenControlTower).toHaveBeenCalledOnce();
  });

  it('shows an error when the summary fails', async () => {
    renderPage({ getDispatchDashboardSummary: vi.fn().mockRejectedValue(new Error('offline')) });

    expect(await screen.findByText(/No se pudo cargar el resumen operativo/)).toBeTruthy();
  });

  it('computes route progress from real order statuses and names driver and vehicle', async () => {
    renderPage({
      getDispatchDashboardSummary: vi.fn().mockResolvedValue(summary),
      listDispatchRoutes: vi.fn().mockResolvedValue([{
        id: 'route-1', publicCode: 'R-001', plannedDate: '2026-11-02', driverId: 'driver-1', vehicleId: 'vehicle-1', status: 'in_progress',
        stops: [
          { id: 'stop-1', sequence: 1, addressLine: 'Av. Uno', latitude: -12.1, longitude: -77.1, orderIds: ['order-1'] },
          { id: 'stop-2', sequence: 2, addressLine: 'Av. Dos', latitude: null, longitude: null, orderIds: ['order-2'] },
        ],
      }]),
      listDeliveryOrders: vi.fn().mockResolvedValue([
        { id: 'order-1', status: 'delivered', timeWindow: 'AM', deliveryAddress: { district: 'Lince' } },
        { id: 'order-2', status: 'in_transit', timeWindow: 'PM', deliveryAddress: { district: 'Surco' } },
      ]),
      listDrivers: vi.fn().mockResolvedValue([{ id: 'driver-1', fullName: 'Ana Quispe' }]),
      listVehicles: vi.fn().mockResolvedValue([{ id: 'vehicle-1', plate: 'ABC-123' }]),
    } as never);

    expect(await screen.findByText('Ana Quispe')).toBeTruthy();
    expect(screen.getByText('ABC-123')).toBeTruthy();
    expect(screen.getByText('1 de 2 pedidos cerrados')).toBeTruthy();
    expect(screen.getByText('50 %')).toBeTruthy();
    expect(await screen.findByText('Pedido registrado para Lince')).toBeTruthy();
    expect((await screen.findByTestId('operations-map')).dataset.stops).toBe('1');
  });

  it('keeps the summary usable when the route details fail to load', async () => {
    renderPage({
      getDispatchDashboardSummary: vi.fn().mockResolvedValue(summary),
      listDispatchRoutes: vi.fn().mockRejectedValue(new Error('offline')),
    });

    expect(await screen.findByText('R-001')).toBeTruthy();
    expect(screen.queryByText(/pedidos cerrados/)).toBeNull();
  });
});
