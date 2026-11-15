import { z } from 'zod';

import type { PageResult } from '../../../../../http/pagination.js';
import { DeliveryOrderValidationError } from '../../../domain/errors/DeliveryOrderError.js';
import { toDeliveryOrderDto, type DeliveryOrderDto } from '../../dto/DeliveryOrderDto.js';
import type {
  DeliveryOrderPageCriteria,
  DeliveryOrderRepository,
} from '../../ports/DeliveryOrderRepository.js';

const organizationSchema = z.uuid();

export interface ListDeliveryOrdersPageInput {
  readonly organizationId: string;
  /** Already validated by the caller (HTTP query schema). */
  readonly criteria: DeliveryOrderPageCriteria;
}

/**
 * Lists one page of the authenticated organization's orders with the filtered
 * total and the status/time-window facet counts.
 */
export class ListDeliveryOrdersPageUseCase {
  constructor(private readonly repository: DeliveryOrderRepository) {}

  async execute(input: ListDeliveryOrdersPageInput): Promise<PageResult<DeliveryOrderDto>> {
    if (!organizationSchema.safeParse(input.organizationId).success) {
      throw new DeliveryOrderValidationError('List delivery orders query is invalid', {
        issues: [{ path: 'organizationId', message: 'Invalid UUID' }],
      });
    }

    const page = await this.repository.listPage(input.organizationId, input.criteria);
    return { ...page, items: page.items.map(toDeliveryOrderDto) };
  }
}
