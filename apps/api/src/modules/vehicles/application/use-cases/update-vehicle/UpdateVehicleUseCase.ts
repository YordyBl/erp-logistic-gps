import { VehicleNotFoundError } from '../../../domain/errors/VehicleError.js';
import { toVehicleDto } from '../../dto/VehicleDto.js';
import type { Clock } from '../../ports/Clock.js';
import type { VehicleRepository } from '../../ports/VehicleRepository.js';
import { parseUpdateVehicleCommand } from './UpdateVehicleCommand.js';
import type { UpdateVehicleResult } from './UpdateVehicleResult.js';

export interface UpdateVehicleDependencies {
  readonly repository: VehicleRepository;
  readonly clock: Clock;
}

/**
 * Applies a partial update to one vehicle inside the caller organization.
 *
 * The vehicle is re-read with the tenant in the key, so an id from another
 * organization is a not-found and no write happens. The entity re-validates the
 * merged result, so an update cannot bypass creation invariants.
 */
export class UpdateVehicleUseCase {
  constructor(private readonly dependencies: UpdateVehicleDependencies) {}

  async execute(input: unknown): Promise<UpdateVehicleResult> {
    const command = parseUpdateVehicleCommand(input);

    const vehicle = await this.dependencies.repository.findById(
      command.organizationId,
      command.vehicleId,
    );

    if (vehicle === null) {
      throw new VehicleNotFoundError(command.vehicleId);
    }

    const updated = vehicle.withChanges(
      {
        type: command.type,
        capacityKg: command.capacityKg,
        status: command.status,
      },
      this.dependencies.clock.now(),
    );

    await this.dependencies.repository.save(updated);

    return { vehicle: toVehicleDto(updated) };
  }
}
