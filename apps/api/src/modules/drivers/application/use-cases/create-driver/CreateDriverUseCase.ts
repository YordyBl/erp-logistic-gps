import { Driver } from '../../../domain/entities/Driver.js';
import { driverDocumentAlreadyInUse } from '../../../domain/errors/DriverError.js';
import { toDriverDto } from '../../dto/DriverDto.js';
import type { Clock } from '../../ports/Clock.js';
import type { DriverRepository } from '../../ports/DriverRepository.js';
import type { IdGenerator } from '../../ports/IdGenerator.js';
import { parseCreateDriverCommand } from './CreateDriverCommand.js';
import type { CreateDriverResult } from './CreateDriverResult.js';

export interface CreateDriverDependencies {
  readonly repository: DriverRepository;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Creates one driver inside the authenticated organization.
 *
 * The document number is checked for per-organization uniqueness before
 * storage; the database constraint remains the correctness boundary for
 * concurrent creates.
 */
export class CreateDriverUseCase {
  constructor(private readonly dependencies: CreateDriverDependencies) {}

  async execute(input: unknown): Promise<CreateDriverResult> {
    const command = parseCreateDriverCommand(input);

    const existing = await this.dependencies.repository.findByDocumentNumber(
      command.organizationId,
      command.documentNumber,
    );

    if (existing !== null) {
      throw driverDocumentAlreadyInUse(
        command.documentNumber,
        command.organizationId,
      );
    }

    const driver = Driver.create({
      id: this.dependencies.idGenerator.nextId(),
      organizationId: command.organizationId,
      fullName: command.fullName,
      documentNumber: command.documentNumber,
      phone: command.phone,
      licenseNumber: command.licenseNumber,
      status: command.status,
      createdAt: this.dependencies.clock.now(),
    });

    await this.dependencies.repository.save(driver);

    return { driver: toDriverDto(driver) };
  }
}
