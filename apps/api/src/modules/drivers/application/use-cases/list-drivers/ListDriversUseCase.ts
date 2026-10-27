import { toDriverDto } from '../../dto/DriverDto.js';
import type { DriverRepository } from '../../ports/DriverRepository.js';
import { parseListDriversQuery } from './ListDriversQuery.js';
import type { ListDriversResult } from './ListDriversResult.js';

export interface ListDriversDependencies {
  readonly repository: DriverRepository;
}

/** Lists the caller organization drivers; the tenant filter is mandatory. */
export class ListDriversUseCase {
  constructor(private readonly dependencies: ListDriversDependencies) {}

  async execute(input: unknown): Promise<ListDriversResult> {
    const query = parseListDriversQuery(input);
    const drivers = await this.dependencies.repository.list(query.organizationId);

    return { drivers: drivers.map(toDriverDto) };
  }
}
