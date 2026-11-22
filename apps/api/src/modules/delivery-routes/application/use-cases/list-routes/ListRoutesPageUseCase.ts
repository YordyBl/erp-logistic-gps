import { z } from 'zod';

import type { PageResult } from '../../../../../http/pagination.js';
import { DeliveryRouteValidationError } from '../../../domain/errors/DeliveryRouteError.js';
import type { PlannedRoute, RoutePageCriteria, RoutePlanningStore } from '../../ports/RoutePlanningStore.js';

const organizationSchema = z.uuid();

export interface ListRoutesPageInput {
  readonly organizationId: string;
  /** Already validated by the caller (HTTP query schema). */
  readonly criteria: RoutePageCriteria;
}

/**
 * Lists one page of the authenticated organization's routes, with their stops,
 * the filtered total and the status facet counts.
 */
export class ListRoutesPageUseCase {
  constructor(private readonly store: RoutePlanningStore) {}

  async execute(input: ListRoutesPageInput): Promise<PageResult<PlannedRoute>> {
    if (!organizationSchema.safeParse(input.organizationId).success) {
      throw new DeliveryRouteValidationError('List routes query is invalid', {
        issues: [{ path: 'organizationId', message: 'Invalid UUID' }],
      });
    }
    return this.store.listPage(input.organizationId, input.criteria);
  }
}
