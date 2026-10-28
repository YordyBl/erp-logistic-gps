import { z } from 'zod';

import type { Clock } from '../../../../../shared/clock.js';
import type { DriverRouteExecutionStore } from '../../ports/DriverRouteExecutionStore.js';
import { DeliveryRouteValidationError } from '../../../domain/errors/DeliveryRouteError.js';

const query = z.strictObject({ organizationId: z.uuid(), actorUserId: z.uuid() });
const startCommand = query.extend({ routeId: z.uuid() });

export class ExecuteDriverRouteUseCase {
  constructor(private readonly store: DriverRouteExecutionStore,
    private readonly clock: Clock) {}

  async mine(input: unknown) {
    const parsed = query.safeParse(input);
    if (!parsed.success) throw new DeliveryRouteValidationError('Driver route query is invalid');
    return { route: await this.store.mine(parsed.data.organizationId, parsed.data.actorUserId) };
  }

  async start(input: unknown) {
    const parsed = startCommand.safeParse(input);
    if (!parsed.success) throw new DeliveryRouteValidationError('Start route command is invalid');
    return { route: await this.store.start(parsed.data.organizationId, parsed.data.routeId,
      parsed.data.actorUserId, this.clock.now()) };
  }
}
