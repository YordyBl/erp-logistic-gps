import type { DataSource } from 'typeorm';

import { SystemClock, type Clock } from '../../../shared/clock.js';
import { generateUuidV4 } from '../../../shared/ids.js';
import { pageOffset, type PageResult } from '../../../http/pagination.js';
import {
  DRIVER_ACCOUNT_STATES,
  foldSearchText,
  type DriverPageCriteria,
  type DriverRepository,
  type DriverSortField,
} from '../application/ports/DriverRepository.js';
import type { IdGenerator } from '../application/ports/IdGenerator.js';
import { CreateDriverUseCase } from '../application/use-cases/create-driver/CreateDriverUseCase.js';
import { GetDriverUseCase } from '../application/use-cases/get-driver/GetDriverUseCase.js';
import { ListDriversPageUseCase } from '../application/use-cases/list-drivers/ListDriversPageUseCase.js';
import { ListDriversUseCase } from '../application/use-cases/list-drivers/ListDriversUseCase.js';
import { UpdateDriverUseCase } from '../application/use-cases/update-driver/UpdateDriverUseCase.js';
import { DRIVER_STATUSES, type Driver } from '../domain/entities/Driver.js';
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

  /** Drivers with a bound account; the in-memory driver repository reads it for the account filter. */
  linkedDriverIds(): ReadonlySet<string> {
    return new Set(this.bindings.keys());
  }

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
  /** Drivers with a bound account, like `driver_accounts` for the PostgreSQL adapter. */
  private linkedDriverIds: () => ReadonlySet<string> = () => new Set();

  /** Points the account filter at the account bindings (the in-memory `driver_accounts`). */
  useAccountLinks(linkedDriverIds: () => ReadonlySet<string>): void {
    this.linkedDriverIds = linkedDriverIds;
  }

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

  /** Same filters, facet counts, order and slicing as the PostgreSQL adapter. */
  async listPage(
    organizationId: string,
    criteria: DriverPageCriteria,
  ): Promise<PageResult<Driver>> {
    const linked = this.linkedDriverIds();
    const tenantDrivers = [...this.drivers.values()].filter(
      (driver) => driver.organizationId === organizationId,
    );
    const matching = (omitSegments = false) =>
      tenantDrivers.filter((driver) => matchesPageCriteria(driver, criteria, linked, omitSegments));

    const status = Object.fromEntries(DRIVER_STATUSES.map((value) => [value, 0])) as Record<string, number>;
    const account = Object.fromEntries(DRIVER_ACCOUNT_STATES.map((value) => [value, 0])) as Record<string, number>;
    for (const driver of matching(true)) {
      status[driver.status] = (status[driver.status] ?? 0) + 1;
      const state = linked.has(driver.id) ? 'linked' : 'unlinked';
      account[state] = (account[state] ?? 0) + 1;
    }

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
      counts: { status, account },
    };
  }
}

/** `omitSegments` skips the status and account filters so their facet counts show every chip. */
function matchesPageCriteria(
  driver: Driver,
  criteria: DriverPageCriteria,
  linked: ReadonlySet<string>,
  omitSegments: boolean,
): boolean {
  if (!omitSegments && criteria.status !== undefined && !criteria.status.includes(driver.status)) return false;
  if (!omitSegments && criteria.account !== undefined &&
      (criteria.account === 'linked') !== linked.has(driver.id)) return false;
  if (criteria.ids !== undefined && !criteria.ids.includes(driver.id)) return false;
  if (criteria.q === undefined) return true;
  const needle = foldSearchText(criteria.q);
  return [driver.fullName, driver.documentNumber, driver.licenseNumber, driver.phone]
    .some((value) => foldSearchText(value).includes(needle));
}

function sortValue(driver: Driver, field: DriverSortField): string {
  switch (field) {
    case 'fullName': return driver.fullName;
    case 'createdAt': return driver.createdAt;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
  readonly listDriversPage: ListDriversPageUseCase;
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
  if (repository instanceof InMemoryDriverRepository && accountBindings instanceof InMemoryDriverAccountBindingStore) {
    repository.useAccountLinks(() => accountBindings.linkedDriverIds());
  }

  return {
    createDriver: new CreateDriverUseCase({ repository, idGenerator, clock }),
    listDrivers: new ListDriversUseCase({ repository }),
    listDriversPage: new ListDriversPageUseCase(repository),
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
