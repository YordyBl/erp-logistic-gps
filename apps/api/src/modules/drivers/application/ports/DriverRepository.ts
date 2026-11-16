import type { PageCriteria, PageResult } from '../../../../http/pagination.js';
import type { Driver, DriverStatus } from '../../domain/entities/Driver.js';

/** Fields `listPage` may sort by; `id` in the same direction always breaks ties. */
export const DRIVER_SORT_FIELDS = ['fullName', 'createdAt'] as const;
export type DriverSortField = (typeof DRIVER_SORT_FIELDS)[number];

/** Whether the driver has an authenticated account bound to it. */
export const DRIVER_ACCOUNT_STATES = ['linked', 'unlinked'] as const;
export type DriverAccountState = (typeof DRIVER_ACCOUNT_STATES)[number];

/**
 * One page of a tenant's drivers. Filters are optional and combine with AND;
 * `q` matches (case- and accent-insensitive substring) the full name, document
 * number, license number and phone.
 */
export interface DriverPageCriteria extends PageCriteria<DriverSortField> {
  readonly status?: readonly DriverStatus[];
  readonly account?: DriverAccountState;
  readonly ids?: readonly string[];
}

/**
 * Persistence port for the driver catalog.
 *
 * Every read is tenant-scoped: the organization is part of the key. The update
 * path re-reads through {@link findByDocumentNumber} only for the create
 * uniqueness check; updates go through `findById` first.
 */
export interface DriverRepository {
  save(driver: Driver): Promise<void>;

  findById(organizationId: string, driverId: string): Promise<Driver | null>;

  findByDocumentNumber(
    organizationId: string,
    documentNumber: string,
  ): Promise<Driver | null>;

  /**
   * Every driver of one organization, oldest first. Kept unpaginated for the
   * selectors and name lookups of the dispatch screens (`GET /drivers/options`).
   */
  list(organizationId: string): Promise<Driver[]>;

  /**
   * One page of the tenant's drivers with the filtered total, `counts.status`
   * and `counts.account`. `status` and `account` are segments of one chip
   * group, so both facets leave out both filters (they keep `q` and `ids`)
   * and list every value (0 when nothing matches).
   */
  listPage(organizationId: string, criteria: DriverPageCriteria): Promise<PageResult<Driver>>;
}

/** Lowercase without diacritics, so "Gomez" finds "Gómez". */
export function foldSearchText(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
