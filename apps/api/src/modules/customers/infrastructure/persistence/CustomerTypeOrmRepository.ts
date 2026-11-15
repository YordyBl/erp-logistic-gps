import { Brackets, type DataSource, type SelectQueryBuilder } from 'typeorm';

import { pageOffset, type PageResult } from '../../../../http/pagination.js';
import type {
  CustomerPageCriteria,
  CustomerRepository,
  CustomerSortField,
} from '../../application/ports/CustomerRepository.js';
import { CUSTOMER_STATUSES, type Customer } from '../../domain/entities/Customer.js';
import { customerCodeAlreadyInUse } from '../../domain/errors/CustomerError.js';
import { CustomerEntity } from './entities/CustomerEntity.js';
import { toCustomerDomain, toCustomerEntity } from './mappers/CustomerMapper.js';
import { readPostgresDriverError, toError } from './postgres-error.js';

/**
 * PostgreSQL adapter for the {@link CustomerRepository} port.
 *
 * Every read filters by `organizationId` in the same query as the id or code, so
 * a caller cannot resolve another tenant row. `uq_customers_organization_public_code`
 * is translated into the same invariant the use-case pre-check raises.
 */
export class CustomerTypeOrmRepository implements CustomerRepository {
  constructor(private readonly dataSource: DataSource) {}

  async save(customer: Customer): Promise<void> {
    try {
      await this.dataSource
        .getRepository(CustomerEntity)
        .save(toCustomerEntity(customer));
    } catch (error) {
      throw translateCustomerPersistenceError(error, customer);
    }
  }

  async findById(
    organizationId: string,
    customerId: string,
  ): Promise<Customer | null> {
    const entity = await this.dataSource
      .getRepository(CustomerEntity)
      .findOne({ where: { id: customerId, organizationId } });

    return entity === null ? null : toCustomerDomain(entity);
  }

  async findByPublicCode(
    organizationId: string,
    publicCode: string,
  ): Promise<Customer | null> {
    const entity = await this.dataSource
      .getRepository(CustomerEntity)
      .findOne({ where: { organizationId, publicCode } });

    return entity === null ? null : toCustomerDomain(entity);
  }

  async list(organizationId: string): Promise<Customer[]> {
    const entities = await this.dataSource.getRepository(CustomerEntity).find({
      where: { organizationId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    return entities.map(toCustomerDomain);
  }

  /**
   * Filtered, sorted `OFFSET`/`LIMIT` page plus a `GROUP BY status` facet that
   * leaves out the status filter itself.
   */
  async listPage(
    organizationId: string,
    criteria: CustomerPageCriteria,
  ): Promise<PageResult<Customer>> {
    const customers = this.dataSource.getRepository(CustomerEntity);
    const filtered = (omitStatus = false): SelectQueryBuilder<CustomerEntity> =>
      applyPageFilters(customers.createQueryBuilder('c'), organizationId, criteria, omitStatus);
    const direction = criteria.sort.direction === 'asc' ? 'ASC' : 'DESC';

    const [[entities, total], statusRows] = await Promise.all([
      filtered()
        .orderBy(`c.${SORT_PROPERTIES[criteria.sort.field]}`, direction)
        .addOrderBy('c.id', direction)
        .offset(pageOffset(criteria))
        .limit(criteria.pageSize)
        .getManyAndCount(),
      filtered(true).select('c.status', 'value').addSelect('COUNT(*)::integer', 'count')
        .groupBy('c.status').getRawMany<FacetRow>(),
    ]);

    return {
      items: entities.map(toCustomerDomain),
      total,
      counts: { status: facetCounts(CUSTOMER_STATUSES, statusRows) },
    };
  }
}

const SORT_PROPERTIES: Record<CustomerSortField, keyof CustomerEntity> = {
  name: 'name',
  createdAt: 'createdAt',
};

const SEARCH_PROPERTIES: readonly (keyof CustomerEntity)[] = [
  'name', 'publicCode', 'contactName', 'contactEmail', 'contactPhone',
];

interface FacetRow {
  readonly value: string;
  readonly count: number | string;
}

/** Every possible value with its count, 0 when no row matched. */
function facetCounts(values: readonly string[], rows: readonly FacetRow[]): Record<string, number> {
  const counts = Object.fromEntries(values.map((value) => [value, 0])) as Record<string, number>;
  for (const row of rows) counts[row.value] = Number(row.count);
  return counts;
}

/** Escapes `ILIKE` wildcards so the search text matches literally. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** Tenant scope plus every page filter, optionally without `status` (its own facet). */
function applyPageFilters(
  query: SelectQueryBuilder<CustomerEntity>,
  organizationId: string,
  criteria: CustomerPageCriteria,
  omitStatus: boolean,
): SelectQueryBuilder<CustomerEntity> {
  query.where('c.organizationId = :organizationId', { organizationId });
  if (!omitStatus && criteria.status !== undefined) {
    query.andWhere('c.status IN (:...status)', { status: criteria.status });
  }
  if (criteria.ids !== undefined) {
    query.andWhere('c.id IN (:...ids)', { ids: criteria.ids });
  }
  const { q } = criteria;
  if (q !== undefined) {
    query.andWhere(new Brackets((search) => {
      for (const property of SEARCH_PROPERTIES) {
        search.orWhere(`c.${property} ILIKE :q ESCAPE '\\'`, { q: likePattern(q) });
      }
    }));
  }
  return query;
}

function translateCustomerPersistenceError(
  error: unknown,
  customer: Customer,
): Error {
  const driverError = readPostgresDriverError(error);

  if (
    driverError?.code === '23505' &&
    driverError.constraint === 'uq_customers_organization_public_code'
  ) {
    return customerCodeAlreadyInUse(customer.publicCode, customer.organizationId);
  }

  return toError(error);
}
