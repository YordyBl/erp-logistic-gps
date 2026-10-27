import { toCustomerDto } from '../../dto/CustomerDto.js';
import type { CustomerRepository } from '../../ports/CustomerRepository.js';
import { parseListCustomersQuery } from './ListCustomersQuery.js';
import type { ListCustomersResult } from './ListCustomersResult.js';

export interface ListCustomersDependencies {
  readonly repository: CustomerRepository;
}

/** Lists the caller organization customers; the tenant filter is mandatory. */
export class ListCustomersUseCase {
  constructor(private readonly dependencies: ListCustomersDependencies) {}

  async execute(input: unknown): Promise<ListCustomersResult> {
    const query = parseListCustomersQuery(input);
    const customers = await this.dependencies.repository.list(query.organizationId);

    return { customers: customers.map(toCustomerDto) };
  }
}
