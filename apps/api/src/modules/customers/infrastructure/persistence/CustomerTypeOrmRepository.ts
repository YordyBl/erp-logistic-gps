import type { DataSource } from 'typeorm';

import type { CustomerRepository } from '../../application/ports/CustomerRepository.js';
import type { Customer } from '../../domain/entities/Customer.js';
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
