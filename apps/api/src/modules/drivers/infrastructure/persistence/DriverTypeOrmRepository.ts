import { Brackets, type DataSource, type SelectQueryBuilder } from 'typeorm';

import { pageOffset, type PageResult } from '../../../../http/pagination.js';
import {
  DRIVER_ACCOUNT_STATES,
  foldSearchText,
  type DriverPageCriteria,
  type DriverRepository,
  type DriverSortField,
} from '../../application/ports/DriverRepository.js';
import { DRIVER_STATUSES, type Driver } from '../../domain/entities/Driver.js';
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

  /**
   * Filtered, sorted `OFFSET`/`LIMIT` page plus `GROUP BY` facets for status and
   * account state. The account state is a cross-module read of `driver_accounts`
   * (owned by the dispatch account binding), resolved with `EXISTS`.
   */
  async listPage(
    organizationId: string,
    criteria: DriverPageCriteria,
  ): Promise<PageResult<Driver>> {
    const drivers = this.dataSource.getRepository(DriverEntity);
    const filtered = (omitSegments = false): SelectQueryBuilder<DriverEntity> =>
      applyPageFilters(drivers.createQueryBuilder('d'), organizationId, criteria, omitSegments);
    const direction = criteria.sort.direction === 'asc' ? 'ASC' : 'DESC';

    const [[entities, total], statusRows, accountRows] = await Promise.all([
      filtered()
        .orderBy(`d.${SORT_PROPERTIES[criteria.sort.field]}`, direction)
        .addOrderBy('d.id', direction)
        .offset(pageOffset(criteria))
        .limit(criteria.pageSize)
        .getManyAndCount(),
      filtered(true).select('d.status', 'value').addSelect('COUNT(*)::integer', 'count')
        .groupBy('d.status').getRawMany<FacetRow>(),
      filtered(true)
        .select(`CASE WHEN ${LINKED_SQL} THEN 'linked' ELSE 'unlinked' END`, 'value')
        .addSelect('COUNT(*)::integer', 'count')
        .groupBy('value').getRawMany<FacetRow>(),
    ]);

    return {
      items: entities.map(toDriverDomain),
      total,
      counts: {
        status: facetCounts(DRIVER_STATUSES, statusRows),
        account: facetCounts(DRIVER_ACCOUNT_STATES, accountRows),
      },
    };
  }
}

const SORT_PROPERTIES: Record<DriverSortField, keyof DriverEntity> = {
  fullName: 'fullName',
  createdAt: 'createdAt',
};

const SEARCH_COLUMNS = ['d.full_name', 'd.document_number', 'd.license_number', 'd.phone'] as const;

/** Accented letters folded by `translate()`, matching {@link foldSearchText} for Spanish text. */
const ACCENTED = 'ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇç';
const PLAIN = 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc';

const LINKED_SQL = `EXISTS (SELECT 1 FROM driver_accounts da
  WHERE da.organization_id = d.organization_id AND da.driver_id = d.id)`;

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

/** Escapes `LIKE` wildcards so the search text matches literally. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** Tenant scope plus every page filter, optionally without `status` and `account` (the chip facets). */
function applyPageFilters(
  query: SelectQueryBuilder<DriverEntity>,
  organizationId: string,
  criteria: DriverPageCriteria,
  omitSegments: boolean,
): SelectQueryBuilder<DriverEntity> {
  query.where('d.organizationId = :organizationId', { organizationId });
  if (!omitSegments && criteria.status !== undefined) {
    query.andWhere('d.status IN (:...status)', { status: criteria.status });
  }
  if (!omitSegments && criteria.account !== undefined) {
    query.andWhere(criteria.account === 'linked' ? LINKED_SQL : `NOT ${LINKED_SQL}`);
  }
  if (criteria.ids !== undefined) {
    query.andWhere('d.id IN (:...ids)', { ids: criteria.ids });
  }
  const { q } = criteria;
  if (q !== undefined) {
    query.andWhere(new Brackets((search) => {
      for (const column of SEARCH_COLUMNS) {
        search.orWhere(`lower(translate(${column}, :accented, :plain)) LIKE :q ESCAPE '\\'`, {
          accented: ACCENTED, plain: PLAIN, q: likePattern(foldSearchText(q)),
        });
      }
    }));
  }
  return query;
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
