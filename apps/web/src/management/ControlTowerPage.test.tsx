// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ControlTowerPage } from './ControlTowerPage.js';

type MapHandler = (event?: unknown) => void;

const mapMock = vi.hoisted(() => ({
  options: undefined as unknown,
  load: undefined as (() => void) | undefined,
  /** Handlers by `event` or `event:layer`, as maplibre delegates layer events. */
  handlers: new Map<string, MapHandler>(),
  /** Features under the pointer for the next `queryRenderedFeatures` call. */
  renderedFeatures: [] as unknown[],
  setWorkerUrl: vi.fn(),
  source: { setData: vi.fn() },
  trackSource: { setData: vi.fn() },
  addSource: vi.fn(),
  addLayer: vi.fn(),
  addImage: vi.fn(),
  flyTo: vi.fn(),
  remove: vi.fn(),
  popup: { setLngLat: vi.fn(), setDOMContent: vi.fn(), addTo: vi.fn(), remove: vi.fn() },
  canvas: { style: { cursor: '' } },
}));

vi.mock('maplibre-gl', () => ({
  setWorkerUrl: mapMock.setWorkerUrl,
  Map: class {
    constructor(options: unknown) { mapMock.options = options; }
    on(event: string, layerOrHandler: string | MapHandler, handler?: MapHandler) {
      if (typeof layerOrHandler === 'string') mapMock.handlers.set(`${event}:${layerOrHandler}`, handler!);
      else if (event === 'load') mapMock.load = layerOrHandler as () => void;
      else mapMock.handlers.set(event, layerOrHandler);
    }
    addControl() {}
    addSource = mapMock.addSource;
    addLayer = mapMock.addLayer;
    addImage = mapMock.addImage;
    flyTo = mapMock.flyTo;
    getZoom() { return 10; }
    getCanvas() { return mapMock.canvas; }
    getLayer(id: string) { return mapMock.addLayer.mock.calls.some(([layer]) => (layer as { id: string }).id === id) ? {} : undefined; }
    queryRenderedFeatures() { return mapMock.renderedFeatures; }
    getSource(id: string) {
      if (!mapMock.addSource.mock.calls.some(([source]) => source === id)) return undefined;
      return id === 'control-tower-track' ? mapMock.trackSource : mapMock.source;
    }
    remove = mapMock.remove;
  },
  Popup: class {
    setLngLat(...args: unknown[]) { mapMock.popup.setLngLat(...args); return this; }
    setDOMContent(...args: unknown[]) { mapMock.popup.setDOMContent(...args); return this; }
    addTo(...args: unknown[]) { mapMock.popup.addTo(...args); return this; }
    remove() { mapMock.popup.remove(); return this; }
  },
  NavigationControl: class {},
}));

vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({
  default: '/assets/maplibre-gl-worker.mjs',
}));

const snapshot = {
  routes: [{
    id: 'route-1', publicCode: 'R-100', plannedDate: '2026-11-02', driverId: 'driver-1',
    vehicleId: 'vehicle-1', status: 'in_progress' as const,
    stops: [{ id: 'stop-1', sequence: 1, addressLine: 'Av. Arequipa 100', latitude: -12.1,
      longitude: -77.03, orderIds: ['order-1'] }],
  }],
  positions: [{ organizationId: 'org-1', routeId: 'route-1', driverId: 'driver-1',
    latitude: -12.08, longitude: -77.02, accuracyMeters: 12, speedMetersPerSecond: 3,
    source: 'simulated' as const, recordedAt: '2026-11-02T12:00:00.000Z',
    receivedAt: '2026-11-02T12:00:02.000Z' }],
};

function createSocketHarness() {
  const listeners = new Map<string, (event: MessageEvent) => void>();
  const socket = {
    addEventListener: vi.fn((type: string, listener: (event: MessageEvent) => void) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    close: vi.fn(),
  };
  return { socket, emit: (data: unknown) => listeners.get('message')?.({ data: JSON.stringify(data) } as MessageEvent) };
}

describe('ControlTowerPage', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    mapMock.options = undefined;
    mapMock.load = undefined;
    mapMock.handlers.clear();
    mapMock.renderedFeatures = [];
    mapMock.canvas.style.cursor = '';
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = '';
      constructor() {
        queueMicrotask(() => this.onload?.());
      }
    });
  });

  it('uses the OpenFreeMap vector style and plots route stops separately from the last known position', async () => {
    const harness = createSocketHarness();
    render(<ControlTowerPage client={{ createTrackingTicket: vi.fn().mockResolvedValue({ ticket: 'one-use-ticket' }) }}
      socketFactory={() => harness.socket as unknown as WebSocket} />);

    await waitFor(() => expect(mapMock.options).toBeDefined());
    expect(mapMock.setWorkerUrl).toHaveBeenCalledWith('/assets/maplibre-gl-worker.mjs');
    expect(mapMock.options).toMatchObject({ style: 'https://tiles.openfreemap.org/styles/bright' });
    act(() => mapMock.load?.());
    act(() => harness.emit({ type: 'snapshot', sequence: 0, data: snapshot }));

    expect(await screen.findByText('R-100')).toBeTruthy();
    expect(screen.getAllByText(/Última posición recibida/).length).toBeGreaterThan(0);
    expect(mapMock.addSource).toHaveBeenCalledWith('control-tower-data', expect.objectContaining({ type: 'geojson' }));
    const sourceConfig = mapMock.source.setData.mock.lastCall?.[0] as { features: { properties: { kind: string } }[] };
    expect(sourceConfig.features.map((feature) => feature.properties.kind)).toEqual(['stop', 'last-known-position']);
    await waitFor(() => expect(mapMock.addImage).toHaveBeenCalledWith('control-tower-motorcycle',
      expect.objectContaining({ src: '/motorcycle-marker.svg' }), { pixelRatio: 2 }));
    expect(mapMock.addLayer.mock.calls.map(([layer]) => (layer as { id: string }).id))
      .toEqual(['control-tower-traveled', 'control-tower-pending', 'control-tower-stops', 'control-tower-stop-labels', 'control-tower-positions']);
    expect(mapMock.addLayer.mock.calls.map(([layer]) => layer))
      .toContainEqual(expect.objectContaining({ id: 'control-tower-positions', type: 'symbol', layout: expect.objectContaining({ 'icon-image': 'control-tower-motorcycle' }) }));
  });

  it('shows who runs each active route, its real progress and its stops', async () => {
    const harness = createSocketHarness();
    const client = {
      createTrackingTicket: vi.fn().mockResolvedValue({ ticket: 'ticket' }),
      listDispatchRoutes: vi.fn().mockResolvedValue([{ ...snapshot.routes[0], organizationId: 'org-1', createdAt: '2026-11-01T10:00:00.000Z' }]),
      listDeliveryOrders: vi.fn().mockResolvedValue([{ id: 'order-1', publicCode: 'PED-001', status: 'delivered' }]),
      listDrivers: vi.fn().mockResolvedValue([{ id: 'driver-1', fullName: 'Ana Quispe' }]),
      listVehicles: vi.fn().mockResolvedValue([{ id: 'vehicle-1', plate: 'ABC-123' }]),
    };
    render(<ControlTowerPage client={client as never} socketFactory={() => harness.socket as unknown as WebSocket} />);
    await waitFor(() => expect(mapMock.options).toBeDefined());
    act(() => harness.emit({ type: 'snapshot', sequence: 0, data: snapshot }));

    expect(await screen.findByText('Ana Quispe')).toBeTruthy();
    expect(screen.getByText('ABC-123')).toBeTruthy();
    expect(screen.getByText('1 de 1 pedido cerrado')).toBeTruthy();
    // Las paradas arrancan cerradas.
    expect(screen.queryByText('Av. Arequipa 100')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /1 parada/ }));
    expect(screen.getByText('Av. Arequipa 100')).toBeTruthy();
    expect(screen.getByText('PED-001 · Entregado')).toBeTruthy();
  });

  it('keeps tracking usable and refreshes progress only when something other than a position changes', async () => {
    const harness = createSocketHarness();
    const listDeliveryOrders = vi.fn().mockRejectedValue(new Error('offline'));
    const client = { createTrackingTicket: vi.fn().mockResolvedValue({ ticket: 'ticket' }), listDeliveryOrders };
    render(<ControlTowerPage client={client as never} socketFactory={() => harness.socket as unknown as WebSocket} />);
    await waitFor(() => expect(mapMock.options).toBeDefined());
    act(() => harness.emit({ type: 'snapshot', sequence: 0, data: snapshot }));

    fireEvent.click(await screen.findByRole('button', { name: /1 parada/ }));
    expect(await screen.findByText('Av. Arequipa 100')).toBeTruthy();
    await waitFor(() => expect(listDeliveryOrders).toHaveBeenCalledOnce());
    act(() => harness.emit({ type: 'update', sequence: 1, kind: 'position', snapshot }));
    expect(listDeliveryOrders).toHaveBeenCalledOnce();
    act(() => harness.emit({ type: 'update', sequence: 2, kind: 'route', snapshot }));
    await waitFor(() => expect(listDeliveryOrders).toHaveBeenCalledTimes(2));
  });

  it('requests a fresh snapshot after a live position update', async () => {
    const harness = createSocketHarness();
    render(<ControlTowerPage client={{ createTrackingTicket: vi.fn().mockResolvedValue({ ticket: 'ticket' }) }}
      socketFactory={() => harness.socket as unknown as WebSocket} />);
    await waitFor(() => expect(mapMock.options).toBeDefined());
    act(() => mapMock.load?.());
    act(() => harness.emit({ type: 'snapshot', sequence: 0, data: snapshot }));
    await screen.findByText('R-100', { selector: 'h3' });
    const updated = { ...snapshot, positions: [{ ...snapshot.positions[0]!, latitude: -12.07,
      longitude: -77.01, receivedAt: '2026-11-02T12:00:05.000Z' }] };
    act(() => harness.emit({ type: 'update', sequence: 1, kind: 'position', snapshot: updated }));

    await waitFor(() => expect(mapMock.source.setData).toHaveBeenCalled());
    expect(screen.getByText(/07:00:05/)).toBeTruthy();
    expect(mapMock.source.setData.mock.lastCall?.[0]).toMatchObject({ features: expect.arrayContaining([
      expect.objectContaining({ geometry: { type: 'Point', coordinates: [-77.01, -12.07] },
        properties: expect.objectContaining({ kind: 'last-known-position' }) }),
    ]) });
  });
});

describe('ControlTowerPage driver selection and route track', () => {
  const track = {
    traveled: [
      { latitude: -12.06, longitude: -77.04, recordedAt: '2026-11-02T11:50:00.000Z' },
      { latitude: -12.08, longitude: -77.02, recordedAt: '2026-11-02T12:00:00.000Z' },
    ],
    pending: [{ latitude: -12.08, longitude: -77.02 }, { latitude: -12.1, longitude: -77.03 }],
    pendingSource: 'straight' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mapMock.options = undefined;
    mapMock.load = undefined;
    mapMock.handlers.clear();
    mapMock.renderedFeatures = [];
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      src = '';
      constructor() { queueMicrotask(() => this.onload?.()); }
    });
  });
  afterEach(() => cleanup());

  async function renderTower(overrides: Record<string, unknown> = {}) {
    const harness = createSocketHarness();
    const client = {
      createTrackingTicket: vi.fn().mockResolvedValue({ ticket: 'ticket' }),
      listDispatchRoutes: vi.fn().mockResolvedValue([{ ...snapshot.routes[0], organizationId: 'org-1', createdAt: '2026-11-01T10:00:00.000Z' }]),
      listDrivers: vi.fn().mockResolvedValue([{ id: 'driver-1', fullName: 'Ana Quispe' }]),
      listVehicles: vi.fn().mockResolvedValue([{ id: 'vehicle-1', plate: 'ABC-123' }]),
      getRouteTrack: vi.fn().mockResolvedValue(track),
      ...overrides,
    };
    render(<ControlTowerPage client={client as never} socketFactory={() => harness.socket as unknown as WebSocket} />);
    await waitFor(() => expect(mapMock.options).toBeDefined());
    act(() => mapMock.load?.());
    act(() => harness.emit({ type: 'snapshot', sequence: 0, data: snapshot }));
    await screen.findByText('Ana Quispe');
    await waitFor(() => expect(mapMock.addLayer.mock.calls.some(([layer]) => (layer as { id: string }).id === 'control-tower-positions')).toBe(true));
    return { client, harness };
  }

  const driverFeature = { geometry: { type: 'Point', coordinates: [-77.02, -12.08] }, properties: { routeId: 'route-1' } };

  it('shows the driver, plate, route and signal age when the pointer is over the driver marker', async () => {
    await renderTower();

    act(() => mapMock.handlers.get('mouseenter:control-tower-positions')?.({ features: [driverFeature] }));

    expect(mapMock.canvas.style.cursor).toBe('pointer');
    expect(mapMock.popup.setLngLat).toHaveBeenCalledWith([-77.02, -12.08]);
    const content = mapMock.popup.setDOMContent.mock.lastCall?.[0] as HTMLElement;
    expect(content.textContent).toContain('Ana Quispe');
    expect(content.textContent).toContain('Placa ABC-123');
    expect(content.textContent).toContain('Ruta R-100');
    expect(content.textContent).toContain('Señal');
    act(() => mapMock.handlers.get('mouseleave:control-tower-positions')?.());
    expect(mapMock.popup.remove).toHaveBeenCalled();
    expect(mapMock.canvas.style.cursor).toBe('');
  });

  it('highlights the route card and draws its driven and pending path when the driver marker is clicked', async () => {
    const { client } = await renderTower();
    const scrollIntoView = vi.fn();
    const card = screen.getByText('R-100', { selector: 'h3' }).closest('li')!;
    card.scrollIntoView = scrollIntoView;

    mapMock.renderedFeatures = [driverFeature];
    act(() => mapMock.handlers.get('click')?.({ point: { x: 1, y: 1 } }));

    await waitFor(() => expect(card.getAttribute('aria-current')).toBe('true'));
    expect(scrollIntoView).toHaveBeenCalled();
    expect(client.getRouteTrack).toHaveBeenCalledWith('route-1');
    await waitFor(() => expect(mapMock.trackSource.setData.mock.lastCall?.[0]).toMatchObject({ features: [
      { geometry: { type: 'LineString', coordinates: [[-77.04, -12.06], [-77.02, -12.08]] }, properties: { kind: 'traveled' } },
      { geometry: { type: 'LineString', coordinates: [[-77.02, -12.08], [-77.03, -12.1]] }, properties: { kind: 'pending' } },
    ] }));
    expect(screen.getByText('Recorrido realizado')).toBeTruthy();
    expect(screen.getByText(/Recorrido pendiente \(en línea recta\)/)).toBeTruthy();

    // A click on the empty map clears the selection and the path.
    mapMock.renderedFeatures = [];
    act(() => mapMock.handlers.get('click')?.({ point: { x: 5, y: 5 } }));
    await waitFor(() => expect(card.getAttribute('aria-current')).toBeNull());
    expect(mapMock.trackSource.setData.mock.lastCall?.[0]).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('centres the map on the driver when a route card is selected, and toggles it off on a second click', async () => {
    const { client } = await renderTower();

    fireEvent.click(screen.getByRole('button', { name: 'Ver la ruta R-100 en el mapa' }));

    expect(mapMock.flyTo).toHaveBeenCalledWith({ center: [-77.02, -12.08], zoom: 13 });
    expect(client.getRouteTrack).toHaveBeenCalledWith('route-1');
    const toggle = screen.getByRole('button', { name: 'Quitar selección de la ruta R-100' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Ver la ruta R-100 en el mapa' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('extends the driven path with live positions and refetches it when deliveries change', async () => {
    const { client, harness } = await renderTower();
    fireEvent.click(screen.getByRole('button', { name: 'Ver la ruta R-100 en el mapa' }));
    await waitFor(() => expect(mapMock.trackSource.setData).toHaveBeenCalled());

    const moved = { ...snapshot, positions: [{ ...snapshot.positions[0]!, latitude: -12.09, longitude: -77.025,
      recordedAt: '2026-11-02T12:01:00.000Z', receivedAt: '2026-11-02T12:01:01.000Z' }] };
    act(() => harness.emit({ type: 'update', sequence: 1, kind: 'position', snapshot: moved }));

    await waitFor(() => expect(mapMock.trackSource.setData.mock.lastCall?.[0]).toMatchObject({ features: [
      { geometry: { coordinates: [[-77.04, -12.06], [-77.02, -12.08], [-77.025, -12.09]] } },
      { geometry: { coordinates: [[-77.025, -12.09], [-77.03, -12.1]] } },
    ] }));
    expect(client.getRouteTrack).toHaveBeenCalledOnce();

    act(() => harness.emit({ type: 'update', sequence: 2, kind: 'order', snapshot: moved }));
    await waitFor(() => expect(client.getRouteTrack).toHaveBeenCalledTimes(2));
  });

  it('keeps selection working without the track endpoint', async () => {
    await renderTower({ getRouteTrack: undefined });

    fireEvent.click(screen.getByRole('button', { name: 'Ver la ruta R-100 en el mapa' }));

    expect(screen.getByText('R-100', { selector: 'h3' }).closest('li')?.getAttribute('aria-current')).toBe('true');
    expect(screen.queryByText('Recorrido realizado')).toBeNull();
  });
});
