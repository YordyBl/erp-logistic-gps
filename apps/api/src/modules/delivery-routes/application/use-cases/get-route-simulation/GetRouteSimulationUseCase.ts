import { z } from 'zod';

import { DeliveryRouteValidationError } from '../../../domain/errors/DeliveryRouteError.js';
import type { RoutePlanningStore } from '../../ports/RoutePlanningStore.js';
import type { RouteSimulationOptions } from '../plan-route/PlanRouteUseCase.js';

const query = z.strictObject({ organizationId: z.uuid() });

/** Tells planners whether route simulation is available and which drivers it may use. */
export class GetRouteSimulationUseCase {
  constructor(private readonly store: RoutePlanningStore,
    private readonly simulation: RouteSimulationOptions = { simulationEnabled: false }) {}

  async execute(input: unknown): Promise<{ simulation: {
    readonly enabled: boolean; readonly eligibleDriverIds: readonly string[];
  } }> {
    const parsed = query.safeParse(input);
    if (!parsed.success) throw new DeliveryRouteValidationError('Route simulation query is invalid');
    if (!this.simulation.simulationEnabled) {
      return { simulation: { enabled: false, eligibleDriverIds: [] } };
    }
    return { simulation: { enabled: true,
      eligibleDriverIds: await this.store.listSimulationEligibleDriverIds(parsed.data.organizationId) } };
  }
}
