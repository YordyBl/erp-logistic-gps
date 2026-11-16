import { z } from 'zod';

import type { PageResult } from '../../../../../http/pagination.js';
import { DriverValidationError } from '../../../domain/errors/DriverError.js';
import { toDriverDto, type DriverDto } from '../../dto/DriverDto.js';
import type { DriverPageCriteria, DriverRepository } from '../../ports/DriverRepository.js';

const organizationSchema = z.uuid();

export interface ListDriversPageInput {
  readonly organizationId: string;
  /** Already validated by the caller (HTTP query schema). */
  readonly criteria: DriverPageCriteria;
}

/**
 * Lists one page of the authenticated organization's drivers with the filtered
 * total and the status and account facet counts. {@link ListDriversUseCase}
 * stays unpaginated for the selectors that need the whole crew.
 */
export class ListDriversPageUseCase {
  constructor(private readonly repository: DriverRepository) {}

  async execute(input: ListDriversPageInput): Promise<PageResult<DriverDto>> {
    if (!organizationSchema.safeParse(input.organizationId).success) {
      throw new DriverValidationError('List drivers query is invalid', {
        issues: [{ path: 'organizationId', message: 'Invalid UUID' }],
      });
    }

    const page = await this.repository.listPage(input.organizationId, input.criteria);
    return { ...page, items: page.items.map(toDriverDto) };
  }
}
