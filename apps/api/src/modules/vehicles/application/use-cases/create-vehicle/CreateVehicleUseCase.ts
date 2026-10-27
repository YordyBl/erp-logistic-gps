import { Vehicle } from '../../../domain/entities/Vehicle.js';
import { vehiclePlateAlreadyInUse } from '../../../domain/errors/VehicleError.js';
import { toVehicleDto } from '../../dto/VehicleDto.js';
import type { Clock } from '../../ports/Clock.js';
import type { IdGenerator } from '../../ports/IdGenerator.js';
import type { VehicleRepository } from '../../ports/VehicleRepository.js';
import { parseCreateVehicleCommand } from './CreateVehicleCommand.js';
import type { CreateVehicleResult } from './CreateVehicleResult.js';

export interface CreateVehicleDependencies {
  readonly repository: VehicleRepository;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Creates one vehicle inside the authenticated organization.
 *
 * The plate is checked for per-organization uniqueness before storage; the
 * database constraint remains the correctness boundary for concurrent creates.
 */
export class CreateVehicleUseCase {
  constructor(private readonly dependencies: CreateVehicleDependencies) {}

  async execute(input: unknown): Promise<CreateVehicleResult> {
    const command = parseCreateVehicleCommand(input);

    const existing = await this.dependencies.repository.findByPlate(
      command.organizationId,
      command.plate,
    );

    if (existing !== null) {
      throw vehiclePlateAlreadyInUse(command.plate, command.organizationId);
    }

    const vehicle = Vehicle.create({
      id: this.dependencies.idGenerator.nextId(),
      organizationId: command.organizationId,
      plate: command.plate,
      type: command.type,
      ...(command.capacityKg === undefined
        ? {}
        : { capacityKg: command.capacityKg }),
      status: command.status,
      createdAt: this.dependencies.clock.now(),
    });

    await this.dependencies.repository.save(vehicle);

    return { vehicle: toVehicleDto(vehicle) };
  }
}
