import type { DataSource } from 'typeorm';

import { SystemClock, type Clock } from '../../../shared/clock.js';
import { generateUuidV4 } from '../../../shared/ids.js';
import type { DriverRepository } from '../application/ports/DriverRepository.js';
import type { IdGenerator } from '../application/ports/IdGenerator.js';
import { CreateDriverUseCase } from '../application/use-cases/create-driver/CreateDriverUseCase.js';
import { GetDriverUseCase } from '../application/use-cases/get-driver/GetDriverUseCase.js';
import { ListDriversUseCase } from '../application/use-cases/list-drivers/ListDriversUseCase.js';
import { UpdateDriverUseCase } from '../application/use-cases/update-driver/UpdateDriverUseCase.js';
import type { Driver } from '../domain/entities/Driver.js';

/**
 * In-memory driver repository for tests and the demo composition.
 *
 * It is deliberately not a production adapter: data disappears with the
 * process. Production wiring uses {@link DriverTypeOrmRepository} through
 * {@link createDriversModuleFromDataSource}; there is no fallback.
 */
export class InMemoryDriverRepository implements DriverRepository {
  private readonly drivers = new Map<string, Driver>();

  async save(driver: Driver): Promise<void> {
    this.drivers.set(driver.id, driver);
  }

  async findById(
    organizationId: string,
    driverId: string,
  ): Promise<Driver | null> {
    const driver = this.drivers.get(driverId);

    return driver !== undefined && driver.organizationId === organizationId
      ? driver
      : null;
  }

  async findByDocumentNumber(
    organizationId: string,
    documentNumber: string,
  ): Promise<Driver | null> {
    for (const driver of this.drivers.values()) {
      if (
        driver.organizationId === organizationId &&
        driver.documentNumber === documentNumber
      ) {
        return driver;
      }
    }

    return null;
  }

  async list(organizationId: string): Promise<Driver[]> {
    return [...this.drivers.values()]
      .filter((driver) => driver.organizationId === organizationId)
      .sort(compareDrivers);
  }
}

function compareDrivers(left: Driver, right: Driver): number {
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

export interface DriversModuleOptions {
  readonly repository?: DriverRepository;
  readonly idGenerator?: IdGenerator;
  readonly clock?: Clock;
}

export interface DriversModule {
  readonly createDriver: CreateDriverUseCase;
  readonly listDrivers: ListDriversUseCase;
  readonly getDriver: GetDriverUseCase;
  readonly updateDriver: UpdateDriverUseCase;
  readonly repository: DriverRepository;
}

/**
 * Builds the driver catalog module.
 *
 * Defaults are in-memory so unit tests and the demo app are constructible
 * without a database; the HTTP process composes the same use cases with
 * PostgreSQL through {@link createDriversModuleFromDataSource}.
 */
export function buildDriversModule(
  options: DriversModuleOptions = {},
): DriversModule {
  const repository = options.repository ?? new InMemoryDriverRepository();
  const idGenerator = options.idGenerator ?? new CryptoIdGenerator();
  const clock = options.clock ?? new SystemClock();

  return {
    createDriver: new CreateDriverUseCase({ repository, idGenerator, clock }),
    listDrivers: new ListDriversUseCase({ repository }),
    getDriver: new GetDriverUseCase({ repository }),
    updateDriver: new UpdateDriverUseCase({ repository, clock }),
    repository,
  };
}

/**
 * Production composition: the PostgreSQL adapter is required and imported
 * dynamically so unit tests that import this file do not load TypeORM entities.
 */
export async function createDriversModuleFromDataSource(
  dataSource: DataSource,
  options: Omit<DriversModuleOptions, 'repository'> = {},
): Promise<DriversModule> {
  const { DriverTypeOrmRepository } = await import(
    '../infrastructure/persistence/DriverTypeOrmRepository.js'
  );

  return buildDriversModule({
    ...options,
    repository: new DriverTypeOrmRepository(dataSource),
  });
}
