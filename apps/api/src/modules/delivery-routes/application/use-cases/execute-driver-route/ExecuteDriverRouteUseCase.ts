import { z } from 'zod';

import type { Clock } from '../../../../../shared/clock.js';
import type { DriverRouteExecutionStore } from '../../ports/DriverRouteExecutionStore.js';
import { DeliveryRouteConflictError, DeliveryRouteValidationError } from '../../../domain/errors/DeliveryRouteError.js';

const query = z.strictObject({ organizationId: z.uuid(), actorUserId: z.uuid() });
const startCommand = query.extend({ routeId: z.uuid() });
const evidenceIds = z.array(z.uuid()).min(1).max(2).refine((ids) => new Set(ids).size === ids.length);
const confirmation = z.strictObject({
  organizationId: z.uuid(), orderId: z.uuid(), actorUserId: z.uuid(),
  evidenceIds,
  receiverName: z.string().trim().min(1).max(120).nullable(),
  notes: z.string().trim().min(1).max(500).nullable(),
});
const incident = z.strictObject({
  organizationId: z.uuid(), orderId: z.uuid(), actorUserId: z.uuid(),
  category: z.enum(['recipient_absent', 'incorrect_address', 'delivery_refused',
    'damaged_package', 'access_restricted', 'vehicle_issue', 'other']),
  description: z.string().trim().min(3).max(1000), evidenceIds,
});
const completeCommand = query.extend({ routeId: z.uuid() });

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

  async confirmDelivery(input: unknown) {
    const parsed = confirmation.safeParse(input);
    if (!parsed.success) throw new DeliveryRouteValidationError('Confirm delivery command is invalid');
    if (this.store.confirmDelivery === undefined) {
      throw new DeliveryRouteConflictError('Delivery outcomes require persistent execution storage');
    }
    const { organizationId, orderId, actorUserId, ...details } = parsed.data;
    await this.store.confirmDelivery(organizationId, orderId, actorUserId, details, this.clock.now());
    return { confirmed: true as const };
  }

  async reportDeliveryIncident(input: unknown) {
    const parsed = incident.safeParse(input);
    if (!parsed.success) throw new DeliveryRouteValidationError('Report delivery incident command is invalid');
    if (this.store.reportDeliveryIncident === undefined) {
      throw new DeliveryRouteConflictError('Delivery outcomes require persistent execution storage');
    }
    const { organizationId, orderId, actorUserId, ...details } = parsed.data;
    return this.store.reportDeliveryIncident(organizationId, orderId, actorUserId, details,
      this.clock.now());
  }

  async complete(input: unknown) {
    const parsed = completeCommand.safeParse(input);
    if (!parsed.success) throw new DeliveryRouteValidationError('Complete route command is invalid');
    if (this.store.complete === undefined) {
      throw new DeliveryRouteConflictError('Route completion requires persistent execution storage');
    }
    return { route: await this.store.complete(parsed.data.organizationId, parsed.data.routeId,
      parsed.data.actorUserId, this.clock.now()) };
  }
}
