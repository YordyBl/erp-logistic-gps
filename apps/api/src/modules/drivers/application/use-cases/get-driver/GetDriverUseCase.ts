import { DriverNotFoundError } from '../../../domain/errors/DriverError.js';
import { toDriverDto } from '../../dto/DriverDto.js';
import type { DriverRepository } from '../../ports/DriverRepository.js';
import { parseGetDriverQuery } from './GetDriverQuery.js';
import type { GetDriverResult } from './GetDriverResult.js';

export interface GetDriverDependencies {
  readonly repository: DriverRepository;
}

/**
 * Reads one driver inside the caller organization.
 *
 * The repository lookup is tenant-scoped, so another organization's driver is
 * indistinguishable from an unknown id.
 */
export class GetDriverUseCase {
  constructor(private readonly dependencies: GetDriverDependencies) {}

  async execute(input: unknown): Promise<GetDriverResult> {
    const query = parseGetDriverQuery(input);

    const driver = await this.dependencies.repository.findById(
      query.organizationId,
      query.driverId,
    );

    if (driver === null) {
      throw new DriverNotFoundError(query.driverId);
    }

    return { driver: toDriverDto(driver) };
  }
}
