import { z } from 'zod';

/**
 * Shared contract for paginated list endpoints (offset + total).
 *
 * Request: `?page=1&pageSize=20&q=text&sort=field:asc|desc` plus each
 * resource's own filters (`status=a,b`, `ids=uuid,uuid`, ...). Routes build a
 * `z.strictObject({ ...pageQueryShape, sort: sortSchema(...), ... })` and run
 * it through the module's `parseXOrThrow`, so any unknown parameter or invalid
 * value becomes the module's typed 400.
 *
 * Response: `{ data, meta: { page, pageSize, total, counts? } }` via
 * {@link toPageResponse}. `counts` holds facet counts (for example
 * `counts.status`) computed with every filter except the facet's own.
 */

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_SEARCH_LENGTH = 100;
export const DEFAULT_MAX_IDS = 200;

export type SortDirection = 'asc' | 'desc';

/**
 * A whitelisted sort. Repositories always append `id` in the same direction as
 * a tiebreaker so offset pages are stable when the sort field has duplicates.
 */
export interface SortSpec<Field extends string = string> {
  readonly field: Field;
  readonly direction: SortDirection;
}

/** What a repository's `listPage` receives besides the organization and its own filters. */
export interface PageCriteria<Field extends string = string> {
  readonly page: number;
  readonly pageSize: number;
  /** Trimmed, non-empty search text; absent means no search. */
  readonly q?: string;
  readonly sort: SortSpec<Field>;
}

/** Facet counts keyed by facet then value, e.g. `{ status: { created: 12 } }`. */
export type PageCounts = Readonly<Record<string, Readonly<Record<string, number>>>>;

/** What a repository's `listPage` returns: one page of items and the filtered total. */
export interface PageResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly counts?: PageCounts;
}

export interface PageResponse<T> {
  readonly data: readonly T[];
  readonly meta: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly counts?: PageCounts;
  };
}

/**
 * Query-string integer in `[min, max]`; absent uses `fallback`. Only plain
 * digits are accepted (`z.coerce` would also take `1e1`, ` 2` or `''`).
 */
export function queryInt(min: number, max: number, fallback: number) {
  return z
    .string()
    .regex(/^\d{1,9}$/, 'must be a positive integer')
    .optional()
    .transform((raw) => (raw === undefined ? fallback : Number(raw)))
    .pipe(z.number().int().min(min).max(max));
}

/**
 * Paging fields every list endpoint accepts. Spread it into the endpoint's
 * `z.strictObject` and replace `sort` with {@link sortSchema} for the
 * resource's whitelist; `q` is trimmed and an empty search is dropped.
 */
export const pageQueryShape = {
  page: queryInt(1, Number.MAX_SAFE_INTEGER, 1),
  pageSize: queryInt(1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE),
  q: z
    .string()
    .trim()
    .max(MAX_SEARCH_LENGTH)
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  sort: z.string().trim().max(64).optional(),
};

/**
 * Parses `field:asc|desc` (or a bare `field`, ascending) against a whitelist.
 * Absent or empty input yields `fallback`; anything else that is not allowed
 * yields `null`, which {@link sortSchema} turns into a validation issue.
 */
export function parseSort<Field extends string>(
  raw: string | undefined,
  allowed: readonly Field[],
  fallback: SortSpec<Field>,
): SortSpec<Field> | null {
  const value = raw?.trim() ?? '';
  if (value === '') return fallback;

  const [field = '', direction = 'asc', ...rest] = value.split(':');
  if (rest.length > 0 || (direction !== 'asc' && direction !== 'desc')) return null;
  if (!(allowed as readonly string[]).includes(field)) return null;

  return { field: field as Field, direction };
}

/** Zod schema for the `sort` parameter: whitelisted `SortSpec`, default when absent, issue when invalid. */
export function sortSchema<Field extends string>(
  allowed: readonly Field[],
  fallback: SortSpec<Field>,
) {
  return z
    .string()
    .max(64)
    .optional()
    .transform((raw, context): SortSpec<Field> => {
      const sort = parseSort(raw, allowed, fallback);
      if (sort === null) {
        context.addIssue({
          code: 'custom',
          message: `sort must be one of ${allowed.join(', ')} followed by :asc or :desc`,
        });
        return z.NEVER;
      }
      return sort;
    });
}

/** Splits `a, b,,a` into unique trimmed values: `['a', 'b']`. */
function splitCsv(raw: string): string[] {
  return [...new Set(raw.split(',').map((part) => part.trim()).filter((part) => part !== ''))];
}

/**
 * Comma-separated enum filter (`status=created,planned`) parsed into a unique,
 * non-empty array. Wrap it in `.optional()` when the filter is optional.
 */
export function csvEnum<const Value extends string>(values: readonly [Value, ...Value[]]) {
  return z
    .string()
    .transform(splitCsv)
    .pipe(z.array(z.enum(values)).min(1));
}

/**
 * Comma-separated UUID filter (`ids=uuid,uuid`) parsed into a unique, non-empty
 * array of at most `max` values. Wrap it in `.optional()` when optional.
 */
export function csvUuid(max = DEFAULT_MAX_IDS) {
  return z
    .string()
    .transform(splitCsv)
    .pipe(z.array(z.uuid()).min(1).max(max));
}

/** Rows to skip for a page: `(page - 1) * pageSize`. */
export function pageOffset(criteria: Pick<PageCriteria, 'page' | 'pageSize'>): number {
  return (criteria.page - 1) * criteria.pageSize;
}

/** Wraps a repository page in the HTTP envelope `{ data, meta }`. */
export function toPageResponse<T>(
  result: PageResult<T>,
  page: number,
  pageSize: number,
): PageResponse<T> {
  return {
    data: result.items,
    meta: {
      page,
      pageSize,
      total: result.total,
      ...(result.counts === undefined ? {} : { counts: result.counts }),
    },
  };
}
