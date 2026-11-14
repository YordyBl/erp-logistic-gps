import { describe, expect, it, vi } from 'vitest';

import { RoutePositionSimulator } from '../application/RoutePositionSimulator.js';

describe('RoutePositionSimulator', () => {
  it('keeps pruning GPS history but samples nothing when simulation is disabled', async () => {
    const store = {
      pruneReceivedBefore: vi.fn().mockResolvedValue(0),
      findLatestForRoutes: vi.fn().mockResolvedValue([]),
      findActiveRoutes: vi.fn().mockResolvedValue([]),
      record: vi.fn().mockResolvedValue(true),
    };
    const provider = { sample: vi.fn() };
    const simulator = new RoutePositionSimulator(store, provider,
      { now: () => '2026-11-02T12:00:04.000Z' },
      { intervalMilliseconds: 4_000, retentionDays: 30, samplingEnabled: false });

    simulator.start();
    await vi.waitFor(() => expect(store.pruneReceivedBefore).toHaveBeenCalledOnce());
    await simulator.stop();

    expect(store.pruneReceivedBefore).toHaveBeenCalledWith('2026-10-03T12:00:04.000Z');
    expect(store.findActiveRoutes).not.toHaveBeenCalled();
    expect(provider.sample).not.toHaveBeenCalled();
    expect(store.record).not.toHaveBeenCalled();
  });

  it('prunes by server receipt time and samples active routes without overlapping ticks', async () => {
    let resolveRecorded!: () => void;
    const recorded = new Promise<void>((resolve) => { resolveRecorded = resolve; });
    const store = {
      pruneReceivedBefore: vi.fn().mockResolvedValue(0),
      findLatestForRoutes: vi.fn().mockResolvedValue([]),
      findActiveRoutes: vi.fn().mockResolvedValue([{
        organizationId: 'org', routeId: 'route', driverId: 'driver',
        startedAt: '2026-11-02T12:00:00.000Z', stops: [],
      }]),
      record: vi.fn().mockImplementation(async () => { resolveRecorded(); return true; }),
    };
    const provider = {
      sample: vi.fn().mockResolvedValue({
        organizationId: 'org', routeId: 'route', driverId: 'driver',
        latitude: -12, longitude: -77, accuracyMeters: 5, speedMetersPerSecond: 0,
        source: 'simulated', recordedAt: '2026-11-02T12:00:04.000Z',
        receivedAt: '2026-11-02T12:00:04.000Z',
      }),
    };
    const clock = { now: () => '2026-11-02T12:00:04.000Z' };
    const onPositionRecorded = vi.fn();
    const simulator = new RoutePositionSimulator(store, provider, clock,
      { intervalMilliseconds: 4_000, retentionDays: 30, samplingEnabled: true }, undefined, onPositionRecorded);

    simulator.start();
    await recorded;
    await simulator.stop();

    expect(store.pruneReceivedBefore).toHaveBeenCalledWith('2026-10-03T12:00:04.000Z');
    expect(provider.sample).toHaveBeenCalledTimes(1);
    expect(store.record).toHaveBeenCalledTimes(1);
    expect(onPositionRecorded).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org', routeId: 'route', source: 'simulated',
    }));
  });

  it('completes an arrived single-delivery simulated route only after recording its destination position', async () => {
    const route = {
      organizationId: 'org', routeId: 'route', driverId: 'driver', driverUserId: 'driver-user',
      simulatedCompletionEnabled: true,
      startedAt: '2026-11-02T12:00:00.000Z', origin: { latitude: -12.01, longitude: -77.01 },
      stops: [{ latitude: -12, longitude: -77, orderIds: ['order'] }],
    };
    const store = {
      pruneReceivedBefore: vi.fn().mockResolvedValue(0),
      findLatestForRoutes: vi.fn().mockResolvedValue([]),
      findActiveRoutes: vi.fn().mockResolvedValue([route]),
      record: vi.fn().mockResolvedValue(true),
    };
    const position = {
      organizationId: 'org', routeId: 'route', driverId: 'driver',
      latitude: -12, longitude: -77, accuracyMeters: 5, speedMetersPerSecond: 8,
      source: 'simulated' as const, recordedAt: '2026-11-02T12:00:04.000Z',
      receivedAt: '2026-11-02T12:00:04.000Z',
    };
    const provider = { sample: vi.fn().mockResolvedValue(position) };
    const onPositionRecorded = vi.fn();
    const onDestinationReached = vi.fn();
    const simulator = new RoutePositionSimulator(store, provider,
      { now: () => position.recordedAt }, { intervalMilliseconds: 4_000, retentionDays: 30, samplingEnabled: true },
      undefined, onPositionRecorded, onDestinationReached);

    simulator.start();
    await vi.waitFor(() => expect(onDestinationReached).toHaveBeenCalledOnce());
    await simulator.stop();

    expect(store.record).toHaveBeenCalledWith(position);
    expect(onDestinationReached).toHaveBeenCalledWith(route, position);
    expect(onPositionRecorded.mock.invocationCallOrder[0])
      .toBeLessThan(onDestinationReached.mock.invocationCallOrder[0]!);
  });

  it('does not auto-complete a route unless simulation completion was explicitly enabled', async () => {
    const route = {
      organizationId: 'org', routeId: 'route', driverId: 'driver', driverUserId: 'driver-user',
      simulatedCompletionEnabled: false,
      startedAt: '2026-11-02T12:00:00.000Z',
      stops: [{ latitude: -12, longitude: -77 }],
    };
    const store = {
      pruneReceivedBefore: vi.fn().mockResolvedValue(0),
      findLatestForRoutes: vi.fn().mockResolvedValue([]),
      findActiveRoutes: vi.fn().mockResolvedValue([route]),
      record: vi.fn().mockResolvedValue(true),
    };
    const position = {
      organizationId: 'org', routeId: 'route', driverId: 'driver',
      latitude: -12, longitude: -77, accuracyMeters: 5, speedMetersPerSecond: 8,
      source: 'simulated' as const, recordedAt: '2026-11-02T12:00:04.000Z',
      receivedAt: '2026-11-02T12:00:04.000Z',
    };
    const onDestinationReached = vi.fn();
    const simulator = new RoutePositionSimulator(store, { sample: vi.fn().mockResolvedValue(position) },
      { now: () => position.recordedAt }, { intervalMilliseconds: 4_000, retentionDays: 30, samplingEnabled: true },
      undefined, undefined, onDestinationReached);

    simulator.start();
    await vi.waitFor(() => expect(store.record).toHaveBeenCalledOnce());
    await simulator.stop();

    expect(onDestinationReached).not.toHaveBeenCalled();
  });

  it.each([
    { source: 'mobile' as const, recorded: true },
    { source: 'simulated' as const, recorded: false },
  ])('does not complete a route for a non-simulated or unrecorded position ($source, recorded=$recorded)', async ({ source, recorded }) => {
    const route = {
      organizationId: 'org', routeId: 'route', driverId: 'driver', driverUserId: 'driver-user',
      startedAt: '2026-11-02T12:00:00.000Z',
      stops: [{ latitude: -12, longitude: -77 }],
    };
    const store = {
      pruneReceivedBefore: vi.fn().mockResolvedValue(0),
      findLatestForRoutes: vi.fn().mockResolvedValue([]),
      findActiveRoutes: vi.fn().mockResolvedValue([route]),
      record: vi.fn().mockResolvedValue(recorded),
    };
    const position = {
      organizationId: 'org', routeId: 'route', driverId: 'driver',
      latitude: -12, longitude: -77, accuracyMeters: 5, speedMetersPerSecond: 8,
      source, recordedAt: '2026-11-02T12:00:04.000Z', receivedAt: '2026-11-02T12:00:04.000Z',
    };
    const provider = { sample: vi.fn().mockResolvedValue(position) };
    const onDestinationReached = vi.fn();
    const simulator = new RoutePositionSimulator(store, provider,
      { now: () => position.recordedAt }, { intervalMilliseconds: 4_000, retentionDays: 30, samplingEnabled: true },
      undefined, undefined, onDestinationReached);

    simulator.start();
    await vi.waitFor(() => expect(store.record).toHaveBeenCalledOnce());
    await simulator.stop();

    expect(onDestinationReached).not.toHaveBeenCalled();
  });
});
