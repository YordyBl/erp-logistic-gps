import { DriverNotFoundError } from '../../../domain/errors/DriverError.js';
import { toDriverDto } from '../../dto/DriverDto.js';
import type { Clock } from '../../ports/Clock.js';
import type { DriverRepository } from '../../ports/DriverRepository.js';
import { parseUpdateDriverCommand } from './UpdateDriverCommand.js';
import type { UpdateDriverResult } from './UpdateDriverResult.js';

export interface UpdateDriverDependencies {
  readonly repository: DriverRepository;
  readonly clock: Clock;
}

/**
 * Applies a partial update to one driver inside the caller organization.
 *
 * The driver is re-read with the tenant in the key, so an id from another
 * organization is a not-found and no write happens. The entity re-validates the
 * merged result, so an update cannot bypass creation invariants.
 */
export class UpdateDriverUseCase {
  constructor(private readonly dependencies: UpdateDriverDependencies) {}

  async execute(input: unknown): Promise<UpdateDriverResult> {
    const command = parseUpdateDriverCommand(input);

    const driver = await this.dependencies.repository.findById(
      command.organizationId,
      command.driverId,
    );

    if (driver === null) {
      throw new DriverNotFoundError(command.driverId);
    }

    const updated = driver.withChanges(
      {
        fullName: command.fullName,
        phone: command.phone,
        licenseNumber: command.licenseNumber,
        status: command.status,
      },
      this.dependencies.clock.now(),
    );

    await this.dependencies.repository.save(updated);

    return { driver: toDriverDto(updated) };
  }
}
