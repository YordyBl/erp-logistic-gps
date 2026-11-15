import { z } from 'zod';

import type { PageResult } from '../../../../../http/pagination.js';
import { CustomerValidationError } from '../../../domain/errors/CustomerError.js';
import { toCustomerDto, type CustomerDto } from '../../dto/CustomerDto.js';
import type {
  CustomerPageCriteria,
  CustomerRepository,
} from '../../ports/CustomerRepository.js';

const organizationSchema = z.uuid();

export interface ListCustomersPageInput {
  readonly organizationId: string;
  /** Already validated by the caller (HTTP query schema). */
  readonly criteria: CustomerPageCriteria;
}

/**
 * Lists one page of the authenticated organization's customers with the
 * filtered total and the status facet counts. {@link ListCustomersUseCase}
 * stays unpaginated for callers that need the whole catalog (order import).
 */
export class ListCustomersPageUseCase {
  constructor(private readonly repository: CustomerRepository) {}

  async execute(input: ListCustomersPageInput): Promise<PageResult<CustomerDto>> {
    if (!organizationSchema.safeParse(input.organizationId).success) {
      throw new CustomerValidationError('List customers query is invalid', {
        issues: [{ path: 'organizationId', message: 'Invalid UUID' }],
      });
    }

    const page = await this.repository.listPage(input.organizationId, input.criteria);
    return { ...page, items: page.items.map(toCustomerDto) };
  }
}
