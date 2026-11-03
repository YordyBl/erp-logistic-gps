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
import type { UserRepository } from '../../identity-and-access/application/ports/UserRepository.js';
import type { DriverAccountBindingStore, DriverAccountOption } from '../application/ports/DriverAccountBindingStore.js';
import { BindDriverAccountUseCase } from '../application/use-cases/bind-driver-account/BindDriverAccountUseCase.js';
import { DriverInvariantError, DriverNotFoundError } from '../domain/errors/DriverError.js';

/** In-memory binding adapter; production uses the database's transactional guard. */
export class InMemoryDriverAccountBindingStore implements DriverAccountBindingStore {
  private readonly bindings = new Map<string, string>();
  private readonly history: Array<{ driverId: string; fromUserId: string | null;
    toUserId: string | null; actorUserId: string; occurredAt: string }> = [];

  constructor(private readonly drivers: DriverRepository,
    private readonly users?: UserRepository) {}

  async get(organizationId: string, driverId: string) {
    if (await this.drivers.findById(organizationId, driverId) === null) {
      throw new DriverNotFoundError(driverId);
    }
    return { driverId, userId: this.bindings.get(driverId) ?? null };
  }

  async listAccounts(organizationId: string): Promise<DriverAccountOption[]> {
    if (this.users === undefined) return [];
    const users = await this.users.listByOrganizationAndRole(organizationId, 'DRIVER');
    const driverByUser = new Map([...this.bindings].map(([driverId, userId]) => [userId, driverId]));
    return users.filter((user) => user.status === 'active' || driverByUser.has(user.id)).map((user) => ({
      userId: user.id,
      email: user.email,
      status: user.status,
      driverId: driverByUser.get(user.id) ?? null,
    }));
  }

  async findDriverId(organizationId: string, userId: string): Promise<string | null> {
    for (const [driverId, linkedUserId] of this.bindings) {
      if (linkedUserId === userId &&
          await this.drivers.findById(organizationId, driverId) !== null) return driverId;
    }
    return null;
  }

  async bind(organizationId: string, driverId: string, userId: string | null,
    actorUserId: string, occurredAt: string) {
    if (await this.drivers.findById(organizationId, driverId) === null) {
      throw new DriverNotFoundError(driverId);
    }
    const actor = await this.users?.findById(actorUserId);
    if (actor === undefined || actor === null || actor.organizationId !== organizationId ||
        actor.role !== 'ADMIN' || actor.status !== 'active') {
      throw new DriverInvariantError('Only an active ADMIN account can bind drivers');
    }
    const previous = this.bindings.get(driverId) ?? null;
    if (previous === userId) return { driverId, userId };
    if (userId !== null) {
      const user = await this.users?.findById(userId);
      if (user === undefined || user === null || user.organizationId !== organizationId) {
        throw new DriverNotFoundError(driverId);
      }
      if (user.role !== 'DRIVER' || user.status !== 'active') {
        throw new DriverInvariantError('Only an active DRIVER account can be linked');
      }
      const owner = await this.findDriverId(organizationId, userId);
      if (owner !== null && owner !== driverId) {
        throw new DriverInvariantError('Account is linked to another driver');
      }
      this.bindings.set(driverId, userId);
    } else {
      this.bindings.delete(driverId);
    }
    this.history.push({ driverId, fromUserId: previous, toUserId: userId,
      actorUserId, occurredAt });
    return { driverId, userId };
  }
}

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
  readonly userRepository?: UserRepository;
  readonly accountBindings?: DriverAccountBindingStore;
}

export interface DriversModule {
  readonly createDriver: CreateDriverUseCase;
  readonly listDrivers: ListDriversUseCase;
  readonly getDriver: GetDriverUseCase;
  readonly updateDriver: UpdateDriverUseCase;
  readonly bindDriverAccount: BindDriverAccountUseCase;
  readonly accountBindings: DriverAccountBindingStore;
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
  const accountBindings = options.accountBindings ?? new InMemoryDriverAccountBindingStore(
    repository, options.userRepository);

  return {
    createDriver: new CreateDriverUseCase({ repository, idGenerator, clock }),
    listDrivers: new ListDriversUseCase({ repository }),
    getDriver: new GetDriverUseCase({ repository }),
    updateDriver: new UpdateDriverUseCase({ repository, clock }),
    bindDriverAccount: new BindDriverAccountUseCase(accountBindings, clock),
    accountBindings,
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
  const { DriverAccountTypeOrmStore } = await import(
    '../../../infrastructure/dispatch/DriverAccountTypeOrmStore.js'
  );

  return buildDriversModule({
    ...options,
    repository: new DriverTypeOrmRepository(dataSource),
    accountBindings: new DriverAccountTypeOrmStore(dataSource),
  });
}
