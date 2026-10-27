import { Customer } from '../../../domain/entities/Customer.js';
import { customerCodeAlreadyInUse } from '../../../domain/errors/CustomerError.js';
import { toCustomerDto } from '../../dto/CustomerDto.js';
import type { Clock } from '../../ports/Clock.js';
import type { CustomerRepository } from '../../ports/CustomerRepository.js';
import type { IdGenerator } from '../../ports/IdGenerator.js';
import { parseCreateCustomerCommand } from './CreateCustomerCommand.js';
import type { CreateCustomerResult } from './CreateCustomerResult.js';

export interface CreateCustomerDependencies {
  readonly repository: CustomerRepository;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Creates one customer inside the authenticated organization.
 *
 * The command is validated at this boundary, the aggregate enforces its
 * invariants, and the public code is checked for per-organization uniqueness.
 * The database constraint remains the correctness boundary for concurrent
 * creates; the adapter translates its violation into the same invariant error.
 */
export class CreateCustomerUseCase {
  constructor(private readonly dependencies: CreateCustomerDependencies) {}

  async execute(input: unknown): Promise<CreateCustomerResult> {
    const command = parseCreateCustomerCommand(input);

    const existing = await this.dependencies.repository.findByPublicCode(
      command.organizationId,
      command.publicCode,
    );

    if (existing !== null) {
      throw customerCodeAlreadyInUse(command.publicCode, command.organizationId);
    }

    const customer = Customer.create({
      id: this.dependencies.idGenerator.nextId(),
      organizationId: command.organizationId,
      publicCode: command.publicCode,
      name: command.name,
      contactName: command.contactName,
      contactEmail: command.contactEmail,
      contactPhone: command.contactPhone,
      status: command.status,
      createdAt: this.dependencies.clock.now(),
    });

    await this.dependencies.repository.save(customer);

    return { customer: toCustomerDto(customer) };
  }
}
