import { describe, expect, it, vi } from 'vitest';

import type { RoutePlanningStore } from '../../ports/RoutePlanningStore.js';
import { GetRouteSimulationUseCase } from './GetRouteSimulationUseCase.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const DRIVER_ID = '33333333-3333-4333-8333-333333333333';

describe('GetRouteSimulationUseCase', () => {
  it('lists drivers without a linked account when simulation is available', async () => {
    const listSimulationEligibleDriverIds = vi.fn().mockResolvedValue([DRIVER_ID]);
    const store = { listSimulationEligibleDriverIds } as unknown as RoutePlanningStore;

    await expect(new GetRouteSimulationUseCase(store, { simulationEnabled: true })
      .execute({ organizationId: ORGANIZATION_ID }))
      .resolves.toEqual({ simulation: { enabled: true, eligibleDriverIds: [DRIVER_ID] } });
    expect(listSimulationEligibleDriverIds).toHaveBeenCalledWith(ORGANIZATION_ID);
  });

  it('reports simulation as unavailable without reading drivers', async () => {
    const listSimulationEligibleDriverIds = vi.fn();
    const store = { listSimulationEligibleDriverIds } as unknown as RoutePlanningStore;

    await expect(new GetRouteSimulationUseCase(store).execute({ organizationId: ORGANIZATION_ID }))
      .resolves.toEqual({ simulation: { enabled: false, eligibleDriverIds: [] } });
    expect(listSimulationEligibleDriverIds).not.toHaveBeenCalled();
  });
});
