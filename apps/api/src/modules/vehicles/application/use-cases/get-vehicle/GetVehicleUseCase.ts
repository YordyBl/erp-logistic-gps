import { VehicleNotFoundError } from '../../../domain/errors/VehicleError.js';
import { toVehicleDto } from '../../dto/VehicleDto.js';
import type { VehicleRepository } from '../../ports/VehicleRepository.js';
import { parseGetVehicleQuery } from './GetVehicleQuery.js';
import type { GetVehicleResult } from './GetVehicleResult.js';

export interface GetVehicleDependencies {
  readonly repository: VehicleRepository;
}

/**
 * Reads one vehicle inside the caller organization.
 *
 * The repository lookup is tenant-scoped, so another organization's vehicle is
 * indistinguishable from an unknown id.
 */
export class GetVehicleUseCase {
  constructor(private readonly dependencies: GetVehicleDependencies) {}

  async execute(input: unknown): Promise<GetVehicleResult> {
    const query = parseGetVehicleQuery(input);

    const vehicle = await this.dependencies.repository.findById(
      query.organizationId,
      query.vehicleId,
    );

    if (vehicle === null) {
      throw new VehicleNotFoundError(query.vehicleId);
    }

    return { vehicle: toVehicleDto(vehicle) };
  }
}
