import type { DataSource } from 'typeorm';

import { SystemClock, type Clock } from '../../../shared/clock.js';
import { generateUuidV4 } from '../../../shared/ids.js';
import type { Customer } from '../domain/entities/Customer.js';
import type { CustomerRepository } from '../application/ports/CustomerRepository.js';
import type { IdGenerator } from '../application/ports/IdGenerator.js';
import { CreateCustomerUseCase } from '../application/use-cases/create-customer/CreateCustomerUseCase.js';
import { GetCustomerUseCase } from '../application/use-cases/get-customer/GetCustomerUseCase.js';
import { ListCustomersUseCase } from '../application/use-cases/list-customers/ListCustomersUseCase.js';

/**
 * In-memory customer repository for tests and the demo composition.
 *
 * It is deliberately not a production adapter: data disappears with the
 * process. Production wiring uses {@link CustomerTypeOrmRepository} through
 * {@link createCustomersModuleFromDataSource}; there is no fallback.
 */
export class InMemoryCustomerRepository implements CustomerRepository {
  private readonly customers = new Map<string, Customer>();

  async save(customer: Customer): Promise<void> {
    this.customers.set(customer.id, customer);
  }

  async findById(
    organizationId: string,
    customerId: string,
  ): Promise<Customer | null> {
    const customer = this.customers.get(customerId);

    return customer !== undefined && customer.organizationId === organizationId
      ? customer
      : null;
  }

  async findByPublicCode(
    organizationId: string,
    publicCode: string,
  ): Promise<Customer | null> {
    for (const customer of this.customers.values()) {
      if (
        customer.organizationId === organizationId &&
        customer.publicCode === publicCode
      ) {
        return customer;
      }
    }

    return null;
  }

  async list(organizationId: string): Promise<Customer[]> {
    return [...this.customers.values()]
      .filter((customer) => customer.organizationId === organizationId)
      .sort(compareCustomers);
  }
}

function compareCustomers(left: Customer, right: Customer): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1;
  }

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export class CryptoIdGenerator implements IdGenerator {
  nextId(): string {
    return generateUuidV4();
  }
}

export interface CustomersModuleOptions {
  readonly repository?: CustomerRepository;
  readonly idGenerator?: IdGenerator;
  readonly clock?: Clock;
}

export interface CustomersModule {
  readonly createCustomer: CreateCustomerUseCase;
  readonly listCustomers: ListCustomersUseCase;
  readonly getCustomer: GetCustomerUseCase;
  readonly repository: CustomerRepository;
}

/**
 * Builds the customer catalog module.
 *
 * Defaults are in-memory so unit tests and the demo app are constructible
 * without a database; the HTTP process composes the same use cases with
 * PostgreSQL through {@link createCustomersModuleFromDataSource}.
 */
export function buildCustomersModule(
  options: CustomersModuleOptions = {},
): CustomersModule {
  const repository = options.repository ?? new InMemoryCustomerRepository();
  const idGenerator = options.idGenerator ?? new CryptoIdGenerator();
  const clock = options.clock ?? new SystemClock();

  return {
    createCustomer: new CreateCustomerUseCase({ repository, idGenerator, clock }),
    listCustomers: new ListCustomersUseCase({ repository }),
    getCustomer: new GetCustomerUseCase({ repository }),
    repository,
  };
}

/**
 * Production composition: the PostgreSQL adapter is required and imported
 * dynamically so unit tests that import this file do not load TypeORM entities.
 */
export async function createCustomersModuleFromDataSource(
  dataSource: DataSource,
  options: Omit<CustomersModuleOptions, 'repository'> = {},
): Promise<CustomersModule> {
  const { CustomerTypeOrmRepository } = await import(
    '../infrastructure/persistence/CustomerTypeOrmRepository.js'
  );

  return buildCustomersModule({
    ...options,
    repository: new CustomerTypeOrmRepository(dataSource),
  });
}
