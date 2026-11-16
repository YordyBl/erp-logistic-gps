import type { DataSource } from 'typeorm';

import { SystemClock, type Clock } from '../../../shared/clock.js';
import { generateUuidV4 } from '../../../shared/ids.js';
import { pageOffset, type PageResult } from '../../../http/pagination.js';
import type { IdGenerator } from '../application/ports/IdGenerator.js';
import type {
  VehiclePageCriteria,
  VehicleRepository,
  VehicleSortField,
} from '../application/ports/VehicleRepository.js';
import { CreateVehicleUseCase } from '../application/use-cases/create-vehicle/CreateVehicleUseCase.js';
import { GetVehicleUseCase } from '../application/use-cases/get-vehicle/GetVehicleUseCase.js';
import { ListVehiclesPageUseCase } from '../application/use-cases/list-vehicles/ListVehiclesPageUseCase.js';
import { ListVehiclesUseCase } from '../application/use-cases/list-vehicles/ListVehiclesUseCase.js';
import { UpdateVehicleUseCase } from '../application/use-cases/update-vehicle/UpdateVehicleUseCase.js';
import { VEHICLE_STATUSES, type Vehicle } from '../domain/entities/Vehicle.js';

/**
 * In-memory vehicle repository for tests and the demo composition.
 *
 * It is deliberately not a production adapter: data disappears with the
 * process. Production wiring uses {@link VehicleTypeOrmRepository} through
 * {@link createVehiclesModuleFromDataSource}; there is no fallback.
 */
export class InMemoryVehicleRepository implements VehicleRepository {
  private readonly vehicles = new Map<string, Vehicle>();

  async save(vehicle: Vehicle): Promise<void> {
    this.vehicles.set(vehicle.id, vehicle);
  }

  async findById(
    organizationId: string,
    vehicleId: string,
  ): Promise<Vehicle | null> {
    const vehicle = this.vehicles.get(vehicleId);

    return vehicle !== undefined && vehicle.organizationId === organizationId
      ? vehicle
      : null;
  }

  async findByPlate(
    organizationId: string,
    plate: string,
  ): Promise<Vehicle | null> {
    for (const vehicle of this.vehicles.values()) {
      if (
        vehicle.organizationId === organizationId &&
        vehicle.plate === plate
      ) {
        return vehicle;
      }
    }

    return null;
  }

  async list(organizationId: string): Promise<Vehicle[]> {
    return [...this.vehicles.values()]
      .filter((vehicle) => vehicle.organizationId === organizationId)
      .sort(compareVehicles);
  }

  /** Same filters, facet counts, order and slicing as the PostgreSQL adapter. */
  async listPage(
    organizationId: string,
    criteria: VehiclePageCriteria,
  ): Promise<PageResult<Vehicle>> {
    const tenantVehicles = [...this.vehicles.values()].filter(
      (vehicle) => vehicle.organizationId === organizationId,
    );
    const matching = (omitStatus = false) =>
      tenantVehicles.filter((vehicle) => matchesPageCriteria(vehicle, criteria, omitStatus));

    const status = Object.fromEntries(VEHICLE_STATUSES.map((value) => [value, 0])) as Record<string, number>;
    for (const vehicle of matching(true)) status[vehicle.status] = (status[vehicle.status] ?? 0) + 1;

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
  vehicle: Vehicle,
  criteria: VehiclePageCriteria,
  omitStatus: boolean,
): boolean {
  if (!omitStatus && criteria.status !== undefined && !criteria.status.includes(vehicle.status)) return false;
  if (criteria.ids !== undefined && !criteria.ids.includes(vehicle.id)) return false;
  if (criteria.q === undefined) return true;
  const needle = criteria.q.toLocaleLowerCase();
  return [vehicle.plate, vehicle.type].some((value) => value.toLocaleLowerCase().includes(needle));
}

function sortValue(vehicle: Vehicle, field: VehicleSortField): string {
  switch (field) {
    case 'plate': return vehicle.plate;
    case 'createdAt': return vehicle.createdAt;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareVehicles(left: Vehicle, right: Vehicle): number {
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

export interface VehiclesModuleOptions {
  readonly repository?: VehicleRepository;
  readonly idGenerator?: IdGenerator;
  readonly clock?: Clock;
}

export interface VehiclesModule {
  readonly createVehicle: CreateVehicleUseCase;
  readonly listVehicles: ListVehiclesUseCase;
  readonly listVehiclesPage: ListVehiclesPageUseCase;
  readonly getVehicle: GetVehicleUseCase;
  readonly updateVehicle: UpdateVehicleUseCase;
  readonly repository: VehicleRepository;
}

/**
 * Builds the vehicle catalog module.
 *
 * Defaults are in-memory so unit tests and the demo app are constructible
 * without a database; the HTTP process composes the same use cases with
 * PostgreSQL through {@link createVehiclesModuleFromDataSource}.
 */
export function buildVehiclesModule(
  options: VehiclesModuleOptions = {},
): VehiclesModule {
  const repository = options.repository ?? new InMemoryVehicleRepository();
  const idGenerator = options.idGenerator ?? new CryptoIdGenerator();
  const clock = options.clock ?? new SystemClock();

  return {
    createVehicle: new CreateVehicleUseCase({ repository, idGenerator, clock }),
    listVehicles: new ListVehiclesUseCase({ repository }),
    listVehiclesPage: new ListVehiclesPageUseCase(repository),
    getVehicle: new GetVehicleUseCase({ repository }),
    updateVehicle: new UpdateVehicleUseCase({ repository, clock }),
    repository,
  };
}

/**
 * Production composition: the PostgreSQL adapter is required and imported
 * dynamically so unit tests that import this file do not load TypeORM entities.
 */
export async function createVehiclesModuleFromDataSource(
  dataSource: DataSource,
  options: Omit<VehiclesModuleOptions, 'repository'> = {},
): Promise<VehiclesModule> {
  const { VehicleTypeOrmRepository } = await import(
    '../infrastructure/persistence/VehicleTypeOrmRepository.js'
  );

  return buildVehiclesModule({
    ...options,
    repository: new VehicleTypeOrmRepository(dataSource),
  });
}
