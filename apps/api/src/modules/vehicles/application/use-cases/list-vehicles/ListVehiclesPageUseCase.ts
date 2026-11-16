import { z } from 'zod';

import type { PageResult } from '../../../../../http/pagination.js';
import { VehicleValidationError } from '../../../domain/errors/VehicleError.js';
import { toVehicleDto, type VehicleDto } from '../../dto/VehicleDto.js';
import type { VehiclePageCriteria, VehicleRepository } from '../../ports/VehicleRepository.js';

const organizationSchema = z.uuid();

export interface ListVehiclesPageInput {
  readonly organizationId: string;
  /** Already validated by the caller (HTTP query schema). */
  readonly criteria: VehiclePageCriteria;
}

/**
 * Lists one page of the authenticated organization's vehicles with the filtered
 * total and the status facet counts. {@link ListVehiclesUseCase} stays
 * unpaginated for the selectors that need the whole fleet.
 */
export class ListVehiclesPageUseCase {
  constructor(private readonly repository: VehicleRepository) {}

  async execute(input: ListVehiclesPageInput): Promise<PageResult<VehicleDto>> {
    if (!organizationSchema.safeParse(input.organizationId).success) {
      throw new VehicleValidationError('List vehicles query is invalid', {
        issues: [{ path: 'organizationId', message: 'Invalid UUID' }],
      });
    }

    const page = await this.repository.listPage(input.organizationId, input.criteria);
    return { ...page, items: page.items.map(toVehicleDto) };
  }
}
