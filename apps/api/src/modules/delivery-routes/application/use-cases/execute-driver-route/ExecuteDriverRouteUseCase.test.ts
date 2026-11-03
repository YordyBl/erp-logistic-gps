import { describe, expect, it, vi } from 'vitest';

import type { Clock } from '../../../../../shared/clock.js';
import type { DriverRouteExecutionStore } from '../../ports/DriverRouteExecutionStore.js';
import { ExecuteDriverRouteUseCase } from './ExecuteDriverRouteUseCase.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const ROUTE_ID = '22222222-2222-4222-8222-222222222222';
const DRIVER_ID = '33333333-3333-4333-8333-333333333333';
const DRIVER_USER_ID = '44444444-4444-4444-8444-444444444444';
const ARRIVAL_TIME = '2026-11-03T20:17:02.852Z';

describe('ExecuteDriverRouteUseCase.completeSimulated', () => {
  it('preserves the recorded GPS arrival time for the audited simulated outcome', async () => {
    const completeSimulated = vi.fn().mockResolvedValue({ id: ROUTE_ID, status: 'completed' });
    const store = { completeSimulated } as unknown as DriverRouteExecutionStore;
    const clock: Clock = { now: () => '2026-11-03T20:17:03.000Z' };
    const useCase = new ExecuteDriverRouteUseCase(store, clock);

    await expect(useCase.completeSimulated({
      organizationId: ORGANIZATION_ID,
      routeId: ROUTE_ID,
      driverId: DRIVER_ID,
      actorUserId: DRIVER_USER_ID,
      occurredAt: ARRIVAL_TIME,
    })).resolves.toMatchObject({ route: { status: 'completed' } });

    expect(completeSimulated).toHaveBeenCalledWith(
      ORGANIZATION_ID, ROUTE_ID, DRIVER_ID, DRIVER_USER_ID, ARRIVAL_TIME,
    );
  });
});
