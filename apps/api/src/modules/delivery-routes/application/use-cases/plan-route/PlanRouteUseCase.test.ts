import { describe, expect, it, vi } from 'vitest';

import type { Clock } from '../../../../delivery-orders/application/ports/Clock.js';
import type { GetDriverUseCase } from '../../../../drivers/application/use-cases/get-driver/GetDriverUseCase.js';
import type { GetVehicleUseCase } from '../../../../vehicles/application/use-cases/get-vehicle/GetVehicleUseCase.js';
import type { MapLinkResolver } from '../../ports/MapLinkResolver.js';
import type { PlannedRoute, RoutePlanDraft, RoutePlanningStore } from '../../ports/RoutePlanningStore.js';
import { PlanRouteUseCase } from './PlanRouteUseCase.js';

const ORDER_ID = '00000000-0000-4000-8000-000000000005';
const input = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  actorUserId: '00000000-0000-4000-8000-000000000002',
  publicCode: 'ROUTE-001',
  plannedDate: '2026-11-03',
  driverId: '00000000-0000-4000-8000-000000000003',
  vehicleId: '00000000-0000-4000-8000-000000000004',
  stops: [{ sequence: 1, orderId: ORDER_ID }],
};

function makeUseCase(mapLinkResolver: MapLinkResolver, simulationEnabled = false) {
  const store = { plan: vi.fn(async (route: RoutePlanDraft) => route as unknown as PlannedRoute) };
  const getDriver = { execute: vi.fn().mockResolvedValue({ driver: { status: 'active' } }) };
  const getVehicle = { execute: vi.fn().mockResolvedValue({ vehicle: { status: 'active' } }) };
  const clock: Clock = { now: () => '2026-11-03T10:00:00.000Z' };
  return {
    useCase: new PlanRouteUseCase(
      store as unknown as RoutePlanningStore,
      getDriver as unknown as GetDriverUseCase,
      getVehicle as unknown as GetVehicleUseCase,
      clock,
      mapLinkResolver,
      { simulationEnabled },
    ),
    store,
  };
}

describe('PlanRouteUseCase Google Maps coordinates', () => {
  it('resolves and persists a separately supplied route origin', async () => {
    const resolver: MapLinkResolver = {
      resolve: vi.fn().mockImplementation(async (url: string) => url === 'https://maps.app.goo.gl/origin'
        ? { latitude: -11.9740702, longitude: -77.0814464 }
        : { latitude: -11.9598866, longitude: -77.0428574 }),
    };
    const { useCase, store } = makeUseCase(resolver, true);

    await useCase.execute({ ...input,
      origin: { addressLine: 'Núcleo de investigación', googleMapsUrl: 'https://maps.app.goo.gl/origin' },
      simulatedCompletionEnabled: true,
    });

    expect(resolver.resolve).toHaveBeenCalledWith('https://maps.app.goo.gl/origin');
    expect(store.plan).toHaveBeenCalledWith(expect.objectContaining({
      origin: { addressLine: 'Núcleo de investigación', latitude: -11.9740702, longitude: -77.0814464 },
      simulatedCompletionEnabled: true,
    }), input.actorUserId);
  });

  it('passes one order per stop to the store and lets it copy the order location', async () => {
    const resolver: MapLinkResolver = { resolve: vi.fn() };
    const { useCase, store } = makeUseCase(resolver);

    await useCase.execute({ ...input, stops: [
      { sequence: 2, orderId: '00000000-0000-4000-8000-000000000006' },
      { sequence: 1, orderId: ORDER_ID },
    ] });

    expect(resolver.resolve).not.toHaveBeenCalled();
    const [draft] = store.plan.mock.calls[0] ?? [];
    expect(draft?.stops).toEqual([
      { id: expect.any(String), sequence: 1, orderId: ORDER_ID },
      { id: expect.any(String), sequence: 2, orderId: '00000000-0000-4000-8000-000000000006' },
    ]);
  });

  it.each([
    ['a stop address', { sequence: 1, orderId: ORDER_ID, addressLine: 'Av. Arequipa 100' }],
    ['a stop map link', { sequence: 1, orderId: ORDER_ID, googleMapsUrl: 'https://maps.app.goo.gl/x' }],
    ['stop coordinates', { sequence: 1, orderId: ORDER_ID, latitude: -12.1, longitude: -77.0 }],
    ['several orders in one stop', { sequence: 1, orderIds: [ORDER_ID, '00000000-0000-4000-8000-000000000006'] }],
  ])('rejects %s because stops inherit their single order location', async (_case, stop) => {
    const { useCase, store } = makeUseCase({ resolve: vi.fn() });

    await expect(useCase.execute({ ...input, stops: [stop] }))
      .rejects.toMatchObject({ code: 'DELIVERY_ROUTE_INVALID_INPUT' });
    expect(store.plan).not.toHaveBeenCalled();
  });

  it('rejects the same order in two stops', async () => {
    const { useCase, store } = makeUseCase({ resolve: vi.fn() });

    await expect(useCase.execute({ ...input, stops: [
      { sequence: 1, orderId: ORDER_ID }, { sequence: 2, orderId: ORDER_ID },
    ] })).rejects.toMatchObject({ code: 'DELIVERY_ROUTE_INVALID_INPUT' });
    expect(store.plan).not.toHaveBeenCalled();
  });

  it('does not persist a route when the origin map link cannot be resolved', async () => {
    const resolver: MapLinkResolver = { resolve: vi.fn().mockRejectedValue(new Error('network failure')) };
    const { useCase, store } = makeUseCase(resolver, true);

    await expect(useCase.execute({ ...input, simulatedCompletionEnabled: true,
      origin: { addressLine: 'Almacen central', googleMapsUrl: 'https://maps.app.goo.gl/origin' } }))
      .rejects.toThrow('Google Maps link could not be resolved');
    expect(store.plan).not.toHaveBeenCalled();
  });
});

describe('PlanRouteUseCase route simulation', () => {
  const resolver: MapLinkResolver = {
    resolve: vi.fn().mockResolvedValue({ latitude: -11.9740702, longitude: -77.0814464 }),
  };
  const origin = { addressLine: 'Núcleo de investigación', latitude: -11.97, longitude: -77.08 };

  it('rejects a simulated route when simulation is unavailable', async () => {
    const { useCase, store } = makeUseCase(resolver, false);

    await expect(useCase.execute({ ...input, origin, simulatedCompletionEnabled: true }))
      .rejects.toMatchObject({ code: 'DELIVERY_ROUTE_INVALID_INPUT',
        message: 'Route simulation is only available in development' });
    expect(store.plan).not.toHaveBeenCalled();
  });

  it('requires an origin for a simulated route', async () => {
    const { useCase, store } = makeUseCase(resolver, true);

    await expect(useCase.execute({ ...input, simulatedCompletionEnabled: true }))
      .rejects.toMatchObject({ code: 'DELIVERY_ROUTE_INVALID_INPUT',
        message: 'Simulated routes require an origin' });
    expect(store.plan).not.toHaveBeenCalled();
  });

  it('keeps planning ordinary routes when simulation is unavailable', async () => {
    const { useCase, store } = makeUseCase(resolver, false);

    await useCase.execute(input);

    expect(store.plan).toHaveBeenCalledWith(expect.objectContaining({
      status: 'planned', simulatedCompletionEnabled: false,
    }), input.actorUserId);
  });
});
