import { z } from 'zod';

import { DeliveryRouteNotFoundError, DeliveryRouteValidationError } from '../../../domain/errors/DeliveryRouteError.js';
import type { RoutePlanningStore } from '../../ports/RoutePlanningStore.js';

const querySchema = z.strictObject({ organizationId: z.uuid(), routeId: z.uuid() });

export class GetRouteUseCase {
  constructor(private readonly store: RoutePlanningStore) {}

  async execute(input: unknown) {
    const parsed = querySchema.safeParse(input);
    if (!parsed.success) {
      throw new DeliveryRouteValidationError('Get route query is invalid', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'), message: issue.message,
        })),
      });
    }
    const route = await this.store.findById(parsed.data.organizationId, parsed.data.routeId);
    if (route === null) throw new DeliveryRouteNotFoundError();
    return { route };
  }
}
