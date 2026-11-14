/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chooseOption, chooseRowAction, pickDay, setupUser } from '../test/ui.js';

import { DispatchPlanningPage } from './DispatchPlanningPage.js';
import type { DeliveryOrder } from '../api/client.js';

const orders: readonly DeliveryOrder[] = [
  { id: 'order-1', organizationId: 'org-1', customerId: 'customer-1', publicCode: 'PED-001', timeWindow: 'AM', status: 'created',
    recipient: { name: 'First Recipient', phone: '999999999' }, deliveryAddress: { addressLine: 'Av. Arequipa 100', district: 'Lima', latitude: null, longitude: null },
    packages: [], createdAt: '2026-11-02T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z' },
  { id: 'order-2', organizationId: 'org-1', customerId: 'customer-1', publicCode: 'PED-002', timeWindow: 'PM', status: 'returned',
    recipient: { name: 'Second Recipient', phone: '999999998' }, deliveryAddress: { addressLine: 'Jr. Lima 200', district: 'Lima', latitude: null, longitude: null },
    packages: [], createdAt: '2026-11-02T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z' },
];

afterEach(cleanup);

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    listDispatchRoutes: vi.fn().mockResolvedValue([]),
    listDeliveryOrders: vi.fn().mockResolvedValue(orders),
    listDrivers: vi.fn().mockResolvedValue([
      { id: 'driver-1', fullName: 'Ana Driver', status: 'active' },
    ]),
    listVehicles: vi.fn().mockResolvedValue([
      { id: 'vehicle-1', plate: 'ABC-123', type: 'Van', status: 'active' },
    ]),
    createDispatchRoute: vi.fn().mockResolvedValue({
      id: 'route-1', publicCode: 'RUTA-001', plannedDate: '2026-11-02',
      driverId: 'driver-1', vehicleId: 'vehicle-1', status: 'planned', stops: [],
    }),
    reassignDispatchRoute: vi.fn(),
    listDeliveryOrderStatusHistory: vi.fn().mockResolvedValue([
      { fromStatus: 'in_transit', toStatus: 'returned', occurredAt: '2026-11-02T12:00:00.000Z' },
    ]),
    ...overrides,
  };
}

describe('DispatchPlanningPage', () => {
  it('creates a manual route with multiple orders grouped in one stop', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<DispatchPlanningPage client={client} />);

    await user.click(await screen.findByRole('button', { name: 'Nueva ruta' }));
    await screen.findByText(/PED-001/);
    await user.type(screen.getByLabelText('Código de ruta'), 'RUTA-001');
    const plannedDate = await pickDay(user, screen.getByLabelText('Fecha planificada'), 15);
    await chooseOption(user, screen.getByLabelText('Conductor'), 'Ana Driver');
    await chooseOption(user, screen.getByLabelText('Vehículo'), /ABC-123/);
    await user.type(screen.getByLabelText('Dirección de parada 1'), 'Av. Arequipa 100');
    await user.click(screen.getByLabelText(/PED-001/));
    await user.click(screen.getByLabelText(/PED-002/));
    await user.click(screen.getByRole('button', { name: 'Crear ruta' }));

    await waitFor(() => expect(client.createDispatchRoute).toHaveBeenCalledWith(expect.objectContaining({
      publicCode: 'RUTA-001',
      plannedDate,
      stops: [expect.objectContaining({ sequence: 1, orderIds: ['order-1', 'order-2'] })],
    })));
    expect((await screen.findByRole('status')).textContent).toContain('Ruta RUTA-001 creada.');
  });

  it('submits an optional Google Maps link with the scheduled stop', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<DispatchPlanningPage client={client} />);

    await user.click(await screen.findByRole('button', { name: 'Nueva ruta' }));
    await screen.findByText(/PED-001/);
    await user.type(screen.getByLabelText('Código de ruta'), 'RUTA-MAPS');
    const plannedDate = await pickDay(user, screen.getByLabelText('Fecha planificada'), 15);
    await chooseOption(user, screen.getByLabelText('Conductor'), 'Ana Driver');
    await chooseOption(user, screen.getByLabelText('Vehículo'), /ABC-123/);
    await user.type(screen.getByLabelText('Dirección de parada 1'), 'Av. Arequipa 100');
    await user.type(screen.getByLabelText(/Enlace de Google Maps de parada 1/),
      'https://maps.app.goo.gl/ykdoXKrKCx7B8APFA');
    await user.click(screen.getByLabelText(/PED-001/));
    await user.click(screen.getByRole('button', { name: 'Crear ruta' }));

    await waitFor(() => expect(client.createDispatchRoute).toHaveBeenCalledWith(expect.objectContaining({
      plannedDate,
      stops: [expect.objectContaining({
        sequence: 1, googleMapsUrl: 'https://maps.app.goo.gl/ykdoXKrKCx7B8APFA',
      })],
    })));
  });

  it('asks for date, driver and vehicle with Spanish messages before calling the API', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<DispatchPlanningPage client={client} />);

    await user.click(await screen.findByRole('button', { name: 'Nueva ruta' }));
    await screen.findByText(/PED-001/);
    await user.type(screen.getByLabelText('Código de ruta'), 'RUTA-001');
    await user.type(screen.getByLabelText('Dirección de parada 1'), 'Av. Arequipa 100');
    await user.click(screen.getByRole('button', { name: 'Crear ruta' }));

    expect(await screen.findByText('Elige la fecha planificada.')).toBeTruthy();
    expect(screen.getByText('Selecciona un conductor.')).toBeTruthy();
    expect(screen.getByText('Selecciona un vehículo.')).toBeTruthy();
    expect(client.createDispatchRoute).not.toHaveBeenCalled();
  });

  it('does not present a failed load as an empty route list', async () => {
    const client = makeClient({ listDispatchRoutes: vi.fn().mockRejectedValue(new Error('offline')) });
    render(<DispatchPlanningPage client={client} />);

    expect(await screen.findByText(/No se pudo cargar la información de despacho/)).toBeTruthy();
    expect(screen.queryByText('No hay rutas para mostrar.')).toBeNull();
  });

  it('shows the recorded returned-order status history before redispatch', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<DispatchPlanningPage client={client} />);

    await user.click(await screen.findByRole('button', { name: 'Nueva ruta' }));
    await screen.findByText(/PED-002/);
    expect(screen.getByText('Devuelto · incidencia registrada')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Ver historial' }));

    expect(await screen.findByText(/Incidencia reportada/)).toBeTruthy();
    expect(client.listDeliveryOrderStatusHistory).toHaveBeenCalledWith('order-2');
  });

  it('submits only changed resources when reassigning a planned route', async () => {
    const user = setupUser();
    const route = {
      id: 'route-1', organizationId: 'org-1', publicCode: 'RUTA-OLD', plannedDate: '2026-11-02',
      driverId: 'driver-1', vehicleId: 'vehicle-1', status: 'planned', createdAt: '2026-11-01T10:00:00.000Z',
      stops: [{ id: 'stop-1', sequence: 1, addressLine: 'Av. Arequipa 100', latitude: null, longitude: null, orderIds: ['order-1'] }],
    } as const;
    const client = makeClient({
      listDispatchRoutes: vi.fn().mockResolvedValue([route]),
      listDrivers: vi.fn().mockResolvedValue([
        { id: 'driver-1', fullName: 'Ana Driver', status: 'active' },
        { id: 'driver-2', fullName: 'Luis Driver', status: 'active' },
      ]),
      reassignDispatchRoute: vi.fn().mockResolvedValue({ ...route, driverId: 'driver-2' }),
    });
    render(<DispatchPlanningPage client={client} />);

    await screen.findByText('RUTA-OLD');
    await chooseRowAction(user, 'Acciones de RUTA-OLD', 'Reasignar');
    await user.click(screen.getByRole('button', { name: 'Guardar reasignación' }));
    expect(client.reassignDispatchRoute).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toBeTruthy();
    await chooseRowAction(user, 'Acciones de RUTA-OLD', 'Reasignar');
    await chooseOption(user, screen.getByLabelText('Reasignar conductor'), 'Luis Driver');
    await user.click(screen.getByRole('button', { name: 'Guardar reasignación' }));

    await waitFor(() => expect(client.reassignDispatchRoute).toHaveBeenCalledWith('route-1', { driverId: 'driver-2' }));
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('shows completed route progress and preserves historical route visibility', async () => {
    const route = {
      id: 'route-1', organizationId: 'org-1', publicCode: 'RUTA-DONE', plannedDate: '2026-11-01',
      driverId: 'driver-1', vehicleId: 'vehicle-1', status: 'completed', createdAt: '2026-10-31T10:00:00.000Z',
      completedAt: '2026-11-01T18:00:00.000Z',
      stops: [{ id: 'stop-1', sequence: 1, addressLine: 'Av. Arequipa 100', latitude: null, longitude: null, orderIds: ['order-1'] }],
    } as const;
    const client = makeClient({ listDispatchRoutes: vi.fn().mockResolvedValue([route]) });
    const user = setupUser();
    render(<DispatchPlanningPage client={client} />);

    await screen.findByText('RUTA-DONE');
    expect(screen.getByText(/Completada/)).toBeTruthy();
    await chooseRowAction(user, 'Acciones de RUTA-DONE', 'Ver detalle');
    expect(screen.getByText('Av. Arequipa 100')).toBeTruthy();
    expect(screen.getByText('PED-001 (Creado)')).toBeTruthy();
  });

  describe('route simulation', () => {
    const simulationClient = (overrides: Record<string, unknown> = {}) => makeClient({
      listDrivers: vi.fn().mockResolvedValue([
        { id: 'driver-1', fullName: 'Ana Driver', status: 'active' },
        { id: 'driver-2', fullName: 'Bruno Simulado', status: 'active' },
      ]),
      getRouteSimulation: vi.fn().mockResolvedValue({ enabled: true, eligibleDriverIds: ['driver-2'] }),
      createDispatchRoute: vi.fn().mockResolvedValue({
        id: 'route-sim', publicCode: 'RUTA-SIM', plannedDate: '2026-11-02', driverId: 'driver-2',
        vehicleId: 'vehicle-1', status: 'in_progress', simulatedCompletionEnabled: true, stops: [],
      }),
      ...overrides,
    });

    async function fillSimulatedRoute(user: ReturnType<typeof setupUser>) {
      await user.click(await screen.findByRole('button', { name: 'Nueva ruta' }));
      await screen.findByText(/PED-001/);
      await user.click(await screen.findByLabelText('Simular ruta'));
      await user.type(screen.getByLabelText('Código de ruta'), 'RUTA-SIM');
      const plannedDate = await pickDay(user, screen.getByLabelText('Fecha planificada'), 15);
      await chooseOption(user, screen.getByLabelText('Vehículo'), /ABC-123/);
      await user.type(screen.getByLabelText('Dirección de parada 1'), 'Av. Arequipa 100');
      await user.click(screen.getByLabelText(/PED-001/));
      return plannedDate;
    }

    it('hides the simulation controls when simulation is unavailable', async () => {
      const user = setupUser();
      render(<DispatchPlanningPage client={makeClient({
        getRouteSimulation: vi.fn().mockResolvedValue({ enabled: false, eligibleDriverIds: [] }),
      })} />);

      await user.click(await screen.findByRole('button', { name: 'Nueva ruta' }));
      await screen.findByText(/PED-001/);

      expect(screen.queryByLabelText('Simular ruta')).toBeNull();
    });

    it('creates a simulated route from an origin with a driver without a linked account', async () => {
      const user = setupUser();
      const client = simulationClient();
      render(<DispatchPlanningPage client={client} />);
      const plannedDate = await fillSimulatedRoute(user);

      await user.click(screen.getByLabelText('Conductor'));
      expect(screen.queryByRole('option', { name: 'Ana Driver' })).toBeNull();
      await user.click(await screen.findByRole('option', { name: 'Bruno Simulado' }));
      await user.type(screen.getByLabelText('Dirección de origen'), 'Núcleo de investigación');
      await user.type(screen.getByLabelText('Enlace de Google Maps del origen'), 'https://maps.app.goo.gl/origin');
      await user.click(screen.getByRole('button', { name: 'Crear ruta' }));

      await waitFor(() => expect(client.createDispatchRoute).toHaveBeenCalledWith(expect.objectContaining({
        publicCode: 'RUTA-SIM', plannedDate, driverId: 'driver-2', simulatedCompletionEnabled: true,
        origin: { addressLine: 'Núcleo de investigación', googleMapsUrl: 'https://maps.app.goo.gl/origin' },
      })));
      expect((await screen.findByRole('status')).textContent).toContain('Ruta RUTA-SIM creada. La simulación ya está en curso.');
    });

    it('asks for the simulation origin before calling the API', async () => {
      const user = setupUser();
      const client = simulationClient();
      render(<DispatchPlanningPage client={client} />);
      await fillSimulatedRoute(user);
      await chooseOption(user, screen.getByLabelText('Conductor'), 'Bruno Simulado');

      await user.click(screen.getByRole('button', { name: 'Crear ruta' }));

      expect(await screen.findByText('Indica la dirección y el enlace de Google Maps del origen de la simulación.')).toBeTruthy();
      expect(client.createDispatchRoute).not.toHaveBeenCalled();
    });

    it('labels simulated routes in the route list', async () => {
      render(<DispatchPlanningPage client={simulationClient({
        listDispatchRoutes: vi.fn().mockResolvedValue([{
          id: 'route-sim', publicCode: 'RUTA-SIM', plannedDate: '2026-11-02', driverId: 'driver-2',
          vehicleId: 'vehicle-1', status: 'in_progress', simulatedCompletionEnabled: true, stops: [],
        }]),
      })} />);

      expect(await screen.findByText('Simulada')).toBeTruthy();
    });
  });
});
