import { CustomerNotFoundError } from '../../../domain/errors/CustomerError.js';
import { toCustomerDto } from '../../dto/CustomerDto.js';
import type { CustomerRepository } from '../../ports/CustomerRepository.js';
import { parseGetCustomerQuery } from './GetCustomerQuery.js';
import type { GetCustomerResult } from './GetCustomerResult.js';

export interface GetCustomerDependencies {
  readonly repository: CustomerRepository;
}

/**
 * Reads one customer inside the caller organization.
 *
 * The repository lookup is already tenant-scoped, so a customer owned by another
 * organization is indistinguishable from an unknown id: both raise
 * `CustomerNotFoundError` and the HTTP layer answers 404.
 */
export class GetCustomerUseCase {
  constructor(private readonly dependencies: GetCustomerDependencies) {}

  async execute(input: unknown): Promise<GetCustomerResult> {
    const query = parseGetCustomerQuery(input);

    const customer = await this.dependencies.repository.findById(
      query.organizationId,
      query.customerId,
    );

    if (customer === null) {
      throw new CustomerNotFoundError(query.customerId);
    }

    return { customer: toCustomerDto(customer) };
  }
}
