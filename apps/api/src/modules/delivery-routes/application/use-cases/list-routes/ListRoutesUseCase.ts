import { z } from 'zod';

import { DeliveryRouteValidationError } from '../../../domain/errors/DeliveryRouteError.js';
import type { RoutePlanningStore } from '../../ports/RoutePlanningStore.js';

const querySchema = z.strictObject({ organizationId: z.uuid() });

export class ListRoutesUseCase {
  constructor(private readonly store: RoutePlanningStore) {}

  async execute(input: unknown) {
    const parsed = querySchema.safeParse(input);
    if (!parsed.success) {
      throw new DeliveryRouteValidationError('List routes query is invalid');
    }
    return { routes: await this.store.list(parsed.data.organizationId) };
  }
}
