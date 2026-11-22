import { describe, expect, it, vi } from 'vitest';

import type { Clock } from '../../../../../shared/clock.js';
import type { DriverRouteExecutionStore } from '../../ports/DriverRouteExecutionStore.js';
import { ExecuteDriverRouteUseCase } from './ExecuteDriverRouteUseCase.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const ROUTE_ID = '22222222-2222-4222-8222-222222222222';
const DISPATCHER_USER_ID = '44444444-4444-4444-8444-444444444444';
const ARRIVAL_TIME = '2026-11-03T20:17:02.852Z';
const clock: Clock = { now: () => '2026-11-03T20:17:03.000Z' };
const command = {
  organizationId: ORGANIZATION_ID,
  routeId: ROUTE_ID,
  actorUserId: DISPATCHER_USER_ID,
  reachedStopCount: 2,
  occurredAt: ARRIVAL_TIME,
};

describe('ExecuteDriverRouteUseCase.completeSimulatedStops', () => {
  it('preserves the recorded GPS time and the reached stop count for the audited outcome', async () => {
    const completeSimulatedStops = vi.fn().mockResolvedValue({ id: ROUTE_ID, status: 'in_progress' });
    const store = { completeSimulatedStops } as unknown as DriverRouteExecutionStore;
    const useCase = new ExecuteDriverRouteUseCase(store, clock, { simulationEnabled: true });

    await expect(useCase.completeSimulatedStops(command))
      .resolves.toMatchObject({ route: { status: 'in_progress' } });

    expect(completeSimulatedStops).toHaveBeenCalledWith(
      ORGANIZATION_ID, ROUTE_ID, DISPATCHER_USER_ID, 2, ARRIVAL_TIME,
    );
  });

  it('closes nothing when route simulation is unavailable', async () => {
    const completeSimulatedStops = vi.fn();
    const store = { completeSimulatedStops } as unknown as DriverRouteExecutionStore;
    const useCase = new ExecuteDriverRouteUseCase(store, clock);

    await expect(useCase.completeSimulatedStops(command)).rejects.toMatchObject({
      message: 'Route simulation is only available in development' });
    expect(completeSimulatedStops).not.toHaveBeenCalled();
  });

  it('rejects a command without a positive reached stop count', async () => {
    const completeSimulatedStops = vi.fn();
    const store = { completeSimulatedStops } as unknown as DriverRouteExecutionStore;
    const useCase = new ExecuteDriverRouteUseCase(store, clock, { simulationEnabled: true });

    await expect(useCase.completeSimulatedStops({ ...command, reachedStopCount: 0 }))
      .rejects.toMatchObject({ code: 'DELIVERY_ROUTE_INVALID_INPUT' });
    expect(completeSimulatedStops).not.toHaveBeenCalled();
  });
});
