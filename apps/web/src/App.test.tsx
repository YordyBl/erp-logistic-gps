/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, type AuthSession, type DeliveryEvidence, type DeliveryOrder, type DeliveryRoute, type Page } from './api/client.js';
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

/** Una página de `GET /delivery-orders` con sus conteos por estado. */
function pageOf(orders: readonly DeliveryOrder[]): Page<DeliveryOrder> {
  const status: Record<string, number> = {};
  for (const item of orders) status[item.status] = (status[item.status] ?? 0) + 1;
  return { data: orders, meta: { page: 1, pageSize: 10, total: orders.length, counts: { status } } };
}

function session(role: AuthSession['user']['role']): AuthSession {
  return {
    accessToken: 'access-token', accessTokenExpiresAt: '2026-10-29T13:00:00.000Z',
    refreshTokenExpiresAt: '2026-11-05T12:00:00.000Z',
    user: { id: 'user-1', organizationId: 'org-1', email: 'operaciones@example.test', role },
  };
}

/** Renders the app at a URL, as the browser router would. */
function renderApp(path = '/app') {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
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

    renderApp();
    expect(screen.queryByLabelText('ID de organización')).toBeNull();
    await user.type(await screen.findByLabelText('Correo operativo'), 'driver@example.test');
    await user.type(screen.getByLabelText('Contraseña'), 'password');
    await user.click(screen.getByRole('button', { name: /Ingresar/ }));

    expect(await screen.findByText('R-041')).toBeTruthy();
    expect(api.login).toHaveBeenCalledWith('driver@example.test', 'password');
  });

  it('validates the sign-in form before calling the API', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(null);
    const login = vi.spyOn(api, 'login');

    renderApp();
    await user.click(await screen.findByRole('button', { name: /Ingresar/ }));
    expect(await screen.findByText('Ingresa tu correo.')).toBeTruthy();
    expect(screen.getByText('Ingresa tu contraseña.')).toBeTruthy();

    await user.type(screen.getByLabelText('Correo operativo'), 'sin-arroba');
    await user.type(screen.getByLabelText('Contraseña'), 'password');
    await user.click(screen.getByRole('button', { name: /Ingresar/ }));
    expect(await screen.findByText('Ingresa un correo válido.')).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
  });

  it('opens Pedidos as a plain link and shows an order detail from the list, not from the menu', async () => {
    const user = userEvent.setup();
    const secondOrder: DeliveryOrder = {
      ...order,
      id: 'order-2',
      publicCode: 'LIM-2042',
      status: 'in_transit',
      recipient: { name: 'Luis Soto', phone: '999 222 333' },
      deliveryAddress: { addressLine: 'Jr. Los Olivos 55', district: 'Miraflores', latitude: null, longitude: null },
    };
    vi.spyOn(api, 'listDeliveryOrdersPage').mockResolvedValue(pageOf([order, secondOrder]));
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DISPATCHER'));

    renderApp();
    await screen.findByRole('heading', { name: 'Estado del reparto' });

    await user.click(screen.getByRole('link', { name: 'Pedidos' }));
    expect(await screen.findByRole('heading', { name: 'Pedidos' })).toBeTruthy();
    // With thousands of orders the menu must stay usable: it never lists order codes.
    expect(screen.queryByRole('button', { name: 'Pedido LIM-2042' })).toBeNull();

    await user.click(await screen.findByText('LIM-2042'));

    expect(await screen.findByRole('heading', { name: 'LIM-2042' })).toBeTruthy();
    expect(screen.getByText('999 222 333')).toBeTruthy();
  });

  it('shows the assigned driver route and start action without exposing operator evidence search', async () => {
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DRIVER'));
    vi.spyOn(api, 'getMyRoute').mockResolvedValue(route);

    renderApp();

    expect(await screen.findByText('R-041')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Iniciar ruta/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Evidencia de entrega' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Clientes' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Pedidos' })).toBeNull();
  });

  it('lets administrators switch between customer and order management', async () => {
    const user = userEvent.setup();
    const customer = {
      id: 'customer-1', organizationId: 'org-1', publicCode: 'CUS-001', name: 'Lima Supply',
      contactName: 'Ana Torres', contactEmail: 'ana@example.test', contactPhone: '+51 900 000 001',
      status: 'active' as const, createdAt: '2026-10-29T12:00:00.000Z',
    };
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('ADMIN'));
    vi.spyOn(api, 'listCustomersPage').mockResolvedValue({
      data: [customer], meta: { page: 1, pageSize: 10, total: 1, counts: { status: { active: 1, inactive: 0 } } },
    });
    vi.spyOn(api, 'listDeliveryOrdersPage').mockResolvedValue(pageOf([order]));

    renderApp();

    await user.click(await screen.findByRole('link', { name: 'Clientes' }));
    expect(await screen.findByRole('heading', { name: 'Clientes' })).toBeTruthy();
    expect(await screen.findByText('Lima Supply')).toBeTruthy();

    await user.click(screen.getByRole('link', { name: 'Pedidos' }));
    expect(await screen.findByRole('heading', { name: 'Pedidos' })).toBeTruthy();
    expect((await screen.findAllByText('LIM-2041')).length).toBeGreaterThan(0);
  });


  it('opens the control tower for dispatchers while keeping it out of the driver workspace', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DISPATCHER'));

    renderApp();
    await user.click(await screen.findByRole('link', { name: 'Torre de control' }));
    expect(await screen.findByRole('heading', { name: 'Torre de control' })).toBeTruthy();

    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DRIVER'));
    vi.spyOn(api, 'getMyRoute').mockResolvedValue(route);
    renderApp();
    await screen.findByText('R-041');
    expect(screen.queryByRole('link', { name: 'Torre de control' })).toBeNull();
  });

  it('opens the operational dashboard by default for operators', async () => {
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DISPATCHER'));

    renderApp();

    expect(await screen.findByRole('heading', { name: 'Estado del reparto' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Resumen' }).getAttribute('aria-current')).toBe('page');
  });

  it('shows driver administration to operators but not DRIVER accounts', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('ADMIN'));
    vi.spyOn(api, 'listDrivers').mockResolvedValue([]);
    vi.spyOn(api, 'listDriverAccounts').mockResolvedValue([]);

    renderApp();
    await user.click(await screen.findByRole('link', { name: 'Conductores' }));
    expect(await screen.findByRole('heading', { name: 'Conductores' })).toBeTruthy();

    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DRIVER'));
    vi.spyOn(api, 'getMyRoute').mockResolvedValue(route);
    renderApp();
    await screen.findByText('R-041');
    expect(screen.queryByRole('link', { name: 'Conductores' })).toBeNull();
  });

  it('opens vehicle management for operators while keeping it out of the DRIVER workspace', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('ADMIN'));
    vi.spyOn(api, 'listVehicles').mockResolvedValue([]);
    renderApp();
    await user.click(await screen.findByRole('link', { name: 'Vehículos' }));
    expect(await screen.findByRole('heading', { name: 'Vehículos' })).toBeTruthy();

    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DRIVER'));
    vi.spyOn(api, 'getMyRoute').mockResolvedValue(route);
    renderApp();
    await screen.findByText('R-041');
    expect(screen.queryByRole('link', { name: 'Vehículos' })).toBeNull();
  });

  it('lets an operator look up private evidence by order code', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DISPATCHER'));
    vi.spyOn(api, 'findOrderByPublicCode').mockResolvedValue({ ...order, status: 'delivered' });
    const listEvidence = vi.spyOn(api, 'listEvidence').mockResolvedValue([evidence]);
    const listEvidencePage = vi.spyOn(api, 'listEvidencePage').mockResolvedValue({ data: [], meta: { page: 1, pageSize: 8, total: 0 } });

    renderApp();
    await user.click(await screen.findByRole('link', { name: 'Evidencias' }));
    await user.type(await screen.findByLabelText('Código del pedido'), 'LIM-2041');

    expect(await screen.findByText('Foto 1')).toBeTruthy();
    expect(listEvidence).toHaveBeenCalledWith(order.id);
    expect(listEvidence).toHaveBeenCalledOnce();
    expect(listEvidencePage).toHaveBeenCalledWith({ page: 1, pageSize: 8 }, expect.any(AbortSignal));
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

    renderApp();
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

    renderApp();
    await user.click(await screen.findByRole('button', { name: /Finalizar ruta/ }));
    await waitFor(() => expect(completeRoute).toHaveBeenCalledWith(route.id));
  });
  it('opens a screen straight from its URL, so it survives a reload', async () => {
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('ADMIN'));
    vi.spyOn(api, 'listVehicles').mockResolvedValue([]);

    renderApp('/app/vehiculos');

    expect(await screen.findByRole('heading', { name: 'Vehículos' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Vehículos' }).getAttribute('aria-current')).toBe('page');
  });

  it('opens an order detail from its own URL', async () => {
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DISPATCHER'));
    vi.spyOn(api, 'listDeliveryOrdersPage').mockResolvedValue(pageOf([order]));

    renderApp('/app/pedidos/LIM-2041');

    expect(await screen.findByRole('heading', { name: 'LIM-2041' })).toBeTruthy();
    // The detail Sheet is modal, so the sidebar behind it is hidden from assistive tech.
    expect(screen.getByRole('link', { name: 'Pedidos', hidden: true }).getAttribute('aria-current')).toBe('page');
  });

  it('sends unknown addresses and the site root to the ERP', async () => {
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DISPATCHER'));

    renderApp('/app/no-existe');
    expect(await screen.findByRole('heading', { name: 'Estado del reparto' })).toBeTruthy();

    cleanup();
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Estado del reparto' })).toBeTruthy();
  });

  it('keeps drivers on their route when they open an operator URL', async () => {
    vi.spyOn(api, 'restoreSession').mockResolvedValue(session('DRIVER'));
    vi.spyOn(api, 'getMyRoute').mockResolvedValue(route);

    renderApp('/app/clientes');

    expect(await screen.findByText('R-041')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Clientes' })).toBeNull();
  });
});
