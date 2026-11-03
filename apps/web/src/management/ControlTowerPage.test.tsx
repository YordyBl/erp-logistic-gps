// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ControlTowerPage } from './ControlTowerPage.js';

const mapMock = vi.hoisted(() => ({
  options: undefined as unknown,
  load: undefined as (() => void) | undefined,
  setWorkerUrl: vi.fn(),
  source: { setData: vi.fn() },
  addSource: vi.fn(),
  addLayer: vi.fn(),
  addImage: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('maplibre-gl', () => ({
  setWorkerUrl: mapMock.setWorkerUrl,
  Map: class {
    constructor(options: unknown) { mapMock.options = options; }
    on(event: string, handler: () => void) { if (event === 'load') mapMock.load = handler; }
    addControl() {}
    addSource = mapMock.addSource;
    addLayer = mapMock.addLayer;
    addImage = mapMock.addImage;
    getSource() { return mapMock.addSource.mock.calls.length > 0 ? mapMock.source : undefined; }
    remove = mapMock.remove;
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
      .toEqual(['control-tower-stops', 'control-tower-stop-labels', 'control-tower-positions']);
    expect(mapMock.addLayer.mock.calls.map(([layer]) => layer))
      .toContainEqual(expect.objectContaining({ id: 'control-tower-positions', type: 'symbol', layout: expect.objectContaining({ 'icon-image': 'control-tower-motorcycle' }) }));
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
