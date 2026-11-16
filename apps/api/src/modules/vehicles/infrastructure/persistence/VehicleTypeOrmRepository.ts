import { Brackets, type DataSource, type SelectQueryBuilder } from 'typeorm';

import { pageOffset, type PageResult } from '../../../../http/pagination.js';
import type {
  VehiclePageCriteria,
  VehicleRepository,
  VehicleSortField,
} from '../../application/ports/VehicleRepository.js';
import { VEHICLE_STATUSES, type Vehicle } from '../../domain/entities/Vehicle.js';
import { vehiclePlateAlreadyInUse } from '../../domain/errors/VehicleError.js';
import { VehicleEntity } from './entities/VehicleEntity.js';
import { toVehicleDomain, toVehicleEntity } from './mappers/VehicleMapper.js';
import { readPostgresDriverError, toError } from './postgres-error.js';

/**
 * PostgreSQL adapter for the {@link VehicleRepository} port.
 *
 * Every read filters by `organizationId` in the same query as the id or plate,
 * so a caller cannot resolve another tenant row.
 */
export class VehicleTypeOrmRepository implements VehicleRepository {
  constructor(private readonly dataSource: DataSource) {}

  async save(vehicle: Vehicle): Promise<void> {
    try {
      await this.dataSource
        .getRepository(VehicleEntity)
        .save(toVehicleEntity(vehicle));
    } catch (error) {
      throw translateVehiclePersistenceError(error, vehicle);
    }
  }

  async findById(
    organizationId: string,
    vehicleId: string,
  ): Promise<Vehicle | null> {
    const entity = await this.dataSource
      .getRepository(VehicleEntity)
      .findOne({ where: { id: vehicleId, organizationId } });

    return entity === null ? null : toVehicleDomain(entity);
  }

  async findByPlate(
    organizationId: string,
    plate: string,
  ): Promise<Vehicle | null> {
    const entity = await this.dataSource
      .getRepository(VehicleEntity)
      .findOne({ where: { organizationId, plate } });

    return entity === null ? null : toVehicleDomain(entity);
  }

  async list(organizationId: string): Promise<Vehicle[]> {
    const entities = await this.dataSource.getRepository(VehicleEntity).find({
      where: { organizationId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    return entities.map(toVehicleDomain);
  }

  /**
   * Filtered, sorted `OFFSET`/`LIMIT` page plus a `GROUP BY status` facet that
   * leaves out the status filter itself.
   */
  async listPage(
    organizationId: string,
    criteria: VehiclePageCriteria,
  ): Promise<PageResult<Vehicle>> {
    const vehicles = this.dataSource.getRepository(VehicleEntity);
    const filtered = (omitStatus = false): SelectQueryBuilder<VehicleEntity> =>
      applyPageFilters(vehicles.createQueryBuilder('v'), organizationId, criteria, omitStatus);
    const direction = criteria.sort.direction === 'asc' ? 'ASC' : 'DESC';

    const [[entities, total], statusRows] = await Promise.all([
      filtered()
        .orderBy(`v.${SORT_PROPERTIES[criteria.sort.field]}`, direction)
        .addOrderBy('v.id', direction)
        .offset(pageOffset(criteria))
        .limit(criteria.pageSize)
        .getManyAndCount(),
      filtered(true).select('v.status', 'value').addSelect('COUNT(*)::integer', 'count')
        .groupBy('v.status').getRawMany<FacetRow>(),
    ]);

    return {
      items: entities.map(toVehicleDomain),
      total,
      counts: { status: facetCounts(VEHICLE_STATUSES, statusRows) },
    };
  }
}

const SORT_PROPERTIES: Record<VehicleSortField, keyof VehicleEntity> = {
  plate: 'plate',
  createdAt: 'createdAt',
};

const SEARCH_PROPERTIES: readonly (keyof VehicleEntity)[] = ['plate', 'type'];

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
  query: SelectQueryBuilder<VehicleEntity>,
  organizationId: string,
  criteria: VehiclePageCriteria,
  omitStatus: boolean,
): SelectQueryBuilder<VehicleEntity> {
  query.where('v.organizationId = :organizationId', { organizationId });
  if (!omitStatus && criteria.status !== undefined) {
    query.andWhere('v.status IN (:...status)', { status: criteria.status });
  }
  if (criteria.ids !== undefined) {
    query.andWhere('v.id IN (:...ids)', { ids: criteria.ids });
  }
  const { q } = criteria;
  if (q !== undefined) {
    query.andWhere(new Brackets((search) => {
      for (const property of SEARCH_PROPERTIES) {
        search.orWhere(`v.${property} ILIKE :q ESCAPE '\\'`, { q: likePattern(q) });
      }
    }));
  }
  return query;
}

function translateVehiclePersistenceError(
  error: unknown,
  vehicle: Vehicle,
): Error {
  const driverError = readPostgresDriverError(error);

  if (
    driverError?.code === '23505' &&
    driverError.constraint === 'uq_vehicles_organization_plate'
  ) {
    return vehiclePlateAlreadyInUse(vehicle.plate, vehicle.organizationId);
  }

  return toError(error);
}
