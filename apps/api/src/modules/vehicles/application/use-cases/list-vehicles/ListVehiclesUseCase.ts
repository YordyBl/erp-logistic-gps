import { toVehicleDto } from '../../dto/VehicleDto.js';
import type { VehicleRepository } from '../../ports/VehicleRepository.js';
import { parseListVehiclesQuery } from './ListVehiclesQuery.js';
import type { ListVehiclesResult } from './ListVehiclesResult.js';

export interface ListVehiclesDependencies {
  readonly repository: VehicleRepository;
}

/** Lists the caller organization vehicles; the tenant filter is mandatory. */
export class ListVehiclesUseCase {
  constructor(private readonly dependencies: ListVehiclesDependencies) {}

  async execute(input: unknown): Promise<ListVehiclesResult> {
    const query = parseListVehiclesQuery(input);
    const vehicles = await this.dependencies.repository.list(query.organizationId);

    return { vehicles: vehicles.map(toVehicleDto) };
  }
}
