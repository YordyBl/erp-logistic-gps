import type { DataSource } from 'typeorm';

import { SystemClock, type Clock } from '../../../shared/clock.js';
import { generateUuidV4 } from '../../../shared/ids.js';
import { pageOffset, type PageResult } from '../../../http/pagination.js';
import { CUSTOMER_STATUSES, type Customer } from '../domain/entities/Customer.js';
import type {
  CustomerPageCriteria,
  CustomerRepository,
  CustomerSortField,
} from '../application/ports/CustomerRepository.js';
import type { IdGenerator } from '../application/ports/IdGenerator.js';
import { CreateCustomerUseCase } from '../application/use-cases/create-customer/CreateCustomerUseCase.js';
import { GetCustomerUseCase } from '../application/use-cases/get-customer/GetCustomerUseCase.js';
import { ListCustomersPageUseCase } from '../application/use-cases/list-customers/ListCustomersPageUseCase.js';
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

  /** Same filters, facet counts, order and slicing as the PostgreSQL adapter. */
  async listPage(
    organizationId: string,
    criteria: CustomerPageCriteria,
  ): Promise<PageResult<Customer>> {
    const tenantCustomers = [...this.customers.values()].filter(
      (customer) => customer.organizationId === organizationId,
    );
    const matching = (omitStatus = false) =>
      tenantCustomers.filter((customer) => matchesPageCriteria(customer, criteria, omitStatus));

    const status = Object.fromEntries(CUSTOMER_STATUSES.map((value) => [value, 0])) as Record<string, number>;
    for (const customer of matching(true)) status[customer.status] = (status[customer.status] ?? 0) + 1;

    const filtered = matching();
    const sign = criteria.sort.direction === 'asc' ? 1 : -1;
    const sorted = filtered.sort((left, right) => sign * (
      compareText(sortValue(left, criteria.sort.field), sortValue(right, criteria.sort.field))
      || compareText(left.id, right.id)
    ));
    const offset = pageOffset(criteria);
    return {
      items: sorted.slice(offset, offset + criteria.pageSize),
      total: filtered.length,
      counts: { status },
    };
  }
}

/** `omitStatus` skips the status filter so its facet counts show every option. */
function matchesPageCriteria(
  customer: Customer,
  criteria: CustomerPageCriteria,
  omitStatus: boolean,
): boolean {
  if (!omitStatus && criteria.status !== undefined && !criteria.status.includes(customer.status)) return false;
  if (criteria.ids !== undefined && !criteria.ids.includes(customer.id)) return false;
  if (criteria.q === undefined) return true;
  const needle = criteria.q.toLocaleLowerCase();
  return [
    customer.name, customer.publicCode, customer.contactName,
    customer.contactEmail, customer.contactPhone,
  ].some((value) => value.toLocaleLowerCase().includes(needle));
}

function sortValue(customer: Customer, field: CustomerSortField): string {
  switch (field) {
    case 'name': return customer.name;
    case 'createdAt': return customer.createdAt;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
  readonly listCustomersPage: ListCustomersPageUseCase;
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
    listCustomersPage: new ListCustomersPageUseCase(repository),
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
