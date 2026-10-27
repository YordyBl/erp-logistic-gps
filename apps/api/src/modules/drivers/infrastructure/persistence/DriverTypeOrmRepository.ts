import type { DataSource } from 'typeorm';

import type { DriverRepository } from '../../application/ports/DriverRepository.js';
import type { Driver } from '../../domain/entities/Driver.js';
import { driverDocumentAlreadyInUse } from '../../domain/errors/DriverError.js';
import { DriverEntity } from './entities/DriverEntity.js';
import { toDriverDomain, toDriverEntity } from './mappers/DriverMapper.js';
import { readPostgresDriverError, toError } from './postgres-error.js';

/**
 * PostgreSQL adapter for the {@link DriverRepository} port.
 *
 * Every read filters by `organizationId` in the same query as the id or document
 * number, so a caller cannot resolve another tenant row.
 */
export class DriverTypeOrmRepository implements DriverRepository {
  constructor(private readonly dataSource: DataSource) {}

  async save(driver: Driver): Promise<void> {
    try {
      await this.dataSource.getRepository(DriverEntity).save(toDriverEntity(driver));
    } catch (error) {
      throw translateDriverPersistenceError(error, driver);
    }
  }

  async findById(
    organizationId: string,
    driverId: string,
  ): Promise<Driver | null> {
    const entity = await this.dataSource
      .getRepository(DriverEntity)
      .findOne({ where: { id: driverId, organizationId } });

    return entity === null ? null : toDriverDomain(entity);
  }

  async findByDocumentNumber(
    organizationId: string,
    documentNumber: string,
  ): Promise<Driver | null> {
    const entity = await this.dataSource
      .getRepository(DriverEntity)
      .findOne({ where: { organizationId, documentNumber } });

    return entity === null ? null : toDriverDomain(entity);
  }

  async list(organizationId: string): Promise<Driver[]> {
    const entities = await this.dataSource.getRepository(DriverEntity).find({
      where: { organizationId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    return entities.map(toDriverDomain);
  }
}

function translateDriverPersistenceError(error: unknown, driver: Driver): Error {
  const driverError = readPostgresDriverError(error);

  if (
    driverError?.code === '23505' &&
    driverError.constraint === 'uq_drivers_organization_document_number'
  ) {
    return driverDocumentAlreadyInUse(driver.documentNumber, driver.organizationId);
  }

  return toError(error);
}
