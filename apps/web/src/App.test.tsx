/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, type AuthSession, type DeliveryEvidence, type DeliveryOrder, type DeliveryRoute } from './api/client.js';
import { App } from './App.js';

vi.mock('./management/ControlTowerPage.js', () => ({
  ControlTowerPage: () => <h1>Torre de control</h1>,
}));

const order: DeliveryOrder = {
  id: 'order-1', organizationId: 'org-1', customerId: 'customer-1', publicCode: 'LIM-2041', status: 'assigned',
  timeWindow: 'AM',
  recipient: { name: 'María Pérez', phone: '999 000 111' },
  deliveryAddress: { addressLine: 'Av. Arequipa 123', district: 'Lince', latitude: null, longitude: null },
  packages: [{ code: 'PKG-01', description: 'Caja mediana', weightKg: null }],
  createdAt: '2026-10-29T12:00:00.000Z', updatedAt: '2026-10-29T12:00:00.000Z',
};

const route: DeliveryRoute = {
  id: 'route-1', publicCode: 'R-041', plannedDate: '2026-10-29', driverId: 'driver-1', vehicleId: 'vehicle-1',
  status: 'planned', startedAt: null, completedAt: null,
  stops: [{ id: 'stop-1', sequence: 1, addressLine: 'Av. Arequipa 123', latitude: null, longitude: null, orders: [order] }],
};

const evidence: DeliveryEvidence = {
  id: 'evidence-1', orderId: order.id, attemptId: 'attempt-1', incidentId: null,
  mimeType: 'image/jpeg', byteSize: 4, checksum: 'checksum', uploadedBy: 'driver-1',
  status: 'available', createdAt: '2026-10-29T12:00:00.000Z', availableAt: '2026-10-29T12:00:01.000Z',
};

function session(role: AuthSession['user']['role']): AuthSession {
  return {
    accessToken: 'access-token', accessTokenExpiresAt: '2026-10-29T13:00:00.000Z',
    refreshTokenExpiresAt: '2026-11-05T12:00:00.000Z',
    user: { id: 'user-1', organizationId: 'org-1', email: 'operaciones@example.test', role },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(api, 'getDispatchDashboardSummary').mockResolvedValue({
    ordersAwaitingPlanning: 0, routesInProgress: 0, deliveriesToday: 0, incidentsToday: 0,
    orderStatusCounts: { created: 0, planned: 0, assigned: 0, in_transit: 0, delivered: 0, returned: 0, cancelled: 0 },
    recentOrders: [], recentIncidents: [], activeRoutes: [],
  });
});

describe('role-specific delivery workspace', () => {
  it('signs in through the API and opens the authenticated driver workspace', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(null);
    vi.spyOn(api, 'login').mockResolvedValue(session('DRIVER'));
    vi.spyOn(api, 'getMyRoute').mockResolvedValue(route);

    render(<App />);
    expect(screen.queryByLabelText('ID de organización')).toBeNull();
    await user.type(await screen.findByLabelText('Correo operativo'), 'driver@example.test');
    await user.type(screen.getByLabelText('Contraseña'), 'password');
    await user.click(screen.getByRole('button', { name: /Ingresar/ }));

    expect(await screen.findByText('R-041')).toBeTruthy();
    expect(api.login).toHaveBeenCalledWith('driver@example.test', 'password');
  });

  it('shows the assigned driver route and start action without exposing operator evidence search', async () => {
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DRIVER'));
    vi.spyOn(api, 'getMyRoute').mockResolvedValue(route);

    render(<App />);

    expect(await screen.findByText('R-041')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Iniciar ruta/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Evidencia de entrega' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clientes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pedidos' })).toBeNull();
  });

  it('lets administrators switch between customer and order management', async () => {
    const user = userEvent.setup();
    const customer = {
      id: 'customer-1', organizationId: 'org-1', publicCode: 'CUS-001', name: 'Lima Supply',
      contactName: 'Ana Torres', contactEmail: 'ana@example.test', contactPhone: '+51 900 000 001',
      status: 'active' as const, createdAt: '2026-10-29T12:00:00.000Z',
    };
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('ADMIN'));
    vi.spyOn(api, 'listCustomers').mockResolvedValue([customer]);
    vi.spyOn(api, 'listDeliveryOrders').mockResolvedValue([order]);

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Clientes' }));
    expect(await screen.findByRole('heading', { name: 'Clientes' })).toBeTruthy();
    expect(await screen.findByText('Lima Supply')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Pedidos' }));
    expect(await screen.findByRole('heading', { name: 'Pedidos de entrega' })).toBeTruthy();
    expect(await screen.findByText('LIM-2041')).toBeTruthy();
  });

  it('opens the control tower for dispatchers while keeping it out of the driver workspace', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DISPATCHER'));

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Torre de control' }));
    expect(await screen.findByRole('heading', { name: 'Torre de control' })).toBeTruthy();

    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DRIVER'));
    vi.spyOn(api, 'getMyRoute').mockResolvedValue(route);
    render(<App />);
    await screen.findByText('R-041');
    expect(screen.queryByRole('button', { name: 'Torre de control' })).toBeNull();
  });

  it('opens the operational dashboard by default for operators', async () => {
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DISPATCHER'));

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Estado del reparto' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resumen' }).getAttribute('aria-current')).toBe('page');
  });

  it('shows driver administration to operators but not DRIVER accounts', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('ADMIN'));
    vi.spyOn(api, 'listDrivers').mockResolvedValue([]);
    vi.spyOn(api, 'listDriverAccounts').mockResolvedValue([]);

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Conductores' }));
    expect(await screen.findByRole('heading', { name: 'Conductores' })).toBeTruthy();

    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DRIVER'));
    vi.spyOn(api, 'getMyRoute').mockResolvedValue(route);
    render(<App />);
    await screen.findByText('R-041');
    expect(screen.queryByRole('button', { name: 'Conductores' })).toBeNull();
  });

  it('opens vehicle management for operators while keeping it out of the DRIVER workspace', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('ADMIN'));
    vi.spyOn(api, 'listVehicles').mockResolvedValue([]);
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Vehículos' }));
    expect(await screen.findByRole('heading', { name: 'Vehículos' })).toBeTruthy();

    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DRIVER'));
    vi.spyOn(api, 'getMyRoute').mockResolvedValue(route);
    render(<App />);
    await screen.findByText('R-041');
    expect(screen.queryByRole('button', { name: 'Vehículos' })).toBeNull();
  });

  it('lets an operator look up private evidence by order code', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DISPATCHER'));
    vi.spyOn(api, 'findOrderByPublicCode').mockResolvedValue({ ...order, status: 'delivered' });
    const listEvidence = vi.spyOn(api, 'listEvidence').mockResolvedValue([evidence]);

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Evidencias' }));
    await user.type(await screen.findByLabelText('Código del pedido'), 'LIM-2041');
    await user.click(screen.getByRole('button', { name: /Buscar pedido/ }));

    expect(await screen.findByText('Foto 1')).toBeTruthy();
    expect(listEvidence).toHaveBeenCalledWith(order.id);
    expect(screen.getByText('Disponible')).toBeTruthy();
  });

  it('requires every order outcome before offering explicit route completion', async () => {
    const activeRoute: DeliveryRoute = {
      ...route,
      status: 'in_progress',
      startedAt: '2026-10-29T12:00:00.000Z',
      stops: [{ ...route.stops[0]!, orders: [{ ...order, status: 'in_transit' }] }],
    };
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DRIVER'));
    vi.spyOn(api, 'getMyRoute').mockResolvedValue(activeRoute);
    const completeRoute = vi.spyOn(api, 'completeRoute');

    render(<App />);
    expect(await screen.findByText('LIM-2041')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Finalizar ruta/ })).toBeNull();
    expect(completeRoute).not.toHaveBeenCalled();
  });

  it('sends route completion only after the driver explicitly confirms it', async () => {
    const user = userEvent.setup();
    const routeWithOutcomes: DeliveryRoute = {
      ...route,
      status: 'in_progress',
      startedAt: '2026-10-29T12:00:00.000Z',
      stops: [{ ...route.stops[0]!, orders: [{ ...order, status: 'delivered' }] }],
    };
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DRIVER'));
    vi.spyOn(api, 'getMyRoute').mockResolvedValue(routeWithOutcomes);
    const completeRoute = vi.spyOn(api, 'completeRoute').mockResolvedValue({ ...routeWithOutcomes, status: 'completed' });

    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Finalizar ruta/ }));
    await waitFor(() => expect(completeRoute).toHaveBeenCalledWith(route.id));
  });
});
