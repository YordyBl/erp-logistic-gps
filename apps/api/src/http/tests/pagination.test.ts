import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  csvEnum,
  csvUuid,
  pageOffset,
  pageQueryShape,
  parseSort,
  sortSchema,
  toPageResponse,
} from '../pagination.js';

const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const listQuerySchema = z.strictObject({
  ...pageQueryShape,
  sort: sortSchema(['createdAt', 'publicCode'] as const, { field: 'createdAt', direction: 'desc' }),
  status: csvEnum(['created', 'planned', 'delivered']).optional(),
  ids: csvUuid(2).optional(),
});

describe('pageQueryShape', () => {
  it('defaults to the first page of 20 with no search', () => {
    expect(z.strictObject(pageQueryShape).parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('parses query-string numbers and trims the search', () => {
    expect(z.strictObject(pageQueryShape).parse({ page: '3', pageSize: '50', q: '  ana  ' }))
      .toEqual({ page: 3, pageSize: 50, q: 'ana' });
  });

  it('drops an empty search', () => {
    expect(z.strictObject(pageQueryShape).parse({ q: '   ' }).q).toBeUndefined();
  });

  it.each([
    ['page', '0'],
    ['page', '-1'],
    ['page', '1.5'],
    ['page', '1e1'],
    ['page', ''],
    ['pageSize', '0'],
    ['pageSize', '101'],
    ['pageSize', 'abc'],
    ['q', 'x'.repeat(101)],
  ])('rejects %s=%j', (key, value) => {
    expect(z.strictObject(pageQueryShape).safeParse({ [key]: value }).success).toBe(false);
  });

  it('rejects repeated parameters, which Express parses as arrays', () => {
    expect(z.strictObject(pageQueryShape).safeParse({ page: ['1', '2'] }).success).toBe(false);
  });

  it('rejects unknown parameters inside a strict object', () => {
    expect(listQuerySchema.safeParse({ limit: '10' }).success).toBe(false);
  });
});

describe('parseSort', () => {
  const allowed = ['createdAt', 'name'] as const;
  const fallback = { field: 'createdAt', direction: 'desc' } as const;

  it('uses the fallback when absent or empty', () => {
    expect(parseSort(undefined, allowed, fallback)).toEqual(fallback);
    expect(parseSort('  ', allowed, fallback)).toEqual(fallback);
  });

  it('accepts whitelisted fields with an explicit or implicit direction', () => {
    expect(parseSort('name:desc', allowed, fallback)).toEqual({ field: 'name', direction: 'desc' });
    expect(parseSort('name', allowed, fallback)).toEqual({ field: 'name', direction: 'asc' });
  });

  it.each(['password:asc', 'name:up', 'name:asc:extra', ':asc', 'NAME:asc'])('rejects %j', (raw) => {
    expect(parseSort(raw, allowed, fallback)).toBeNull();
  });
});

describe('sortSchema', () => {
  it('turns an invalid sort into a validation issue on the sort path', () => {
    const result = listQuerySchema.safeParse({ sort: 'recipientPhone:asc' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['sort']);
  });

  it('returns the resource default when absent', () => {
    expect(listQuerySchema.parse({}).sort).toEqual({ field: 'createdAt', direction: 'desc' });
  });
});

describe('csvEnum', () => {
  it('splits, trims and deduplicates values', () => {
    expect(listQuerySchema.parse({ status: 'created, planned,,created' }).status)
      .toEqual(['created', 'planned']);
  });

  it.each(['', ',', 'created,unknown'])('rejects %j', (status) => {
    expect(listQuerySchema.safeParse({ status }).success).toBe(false);
  });
});

describe('csvUuid', () => {
  it('parses unique ids up to the limit', () => {
    expect(listQuerySchema.parse({ ids: `${UUID_A},${UUID_B},${UUID_A}` }).ids).toEqual([UUID_A, UUID_B]);
  });

  it('rejects malformed ids and lists over the limit', () => {
    expect(listQuerySchema.safeParse({ ids: 'not-a-uuid' }).success).toBe(false);
    expect(listQuerySchema.safeParse({
      ids: `${UUID_A},${UUID_B},cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
    }).success).toBe(false);
  });

  it('allows 200 ids by default', () => {
    const ids = Array.from({ length: 201 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);

    expect(csvUuid().safeParse(ids.slice(0, 200).join(',')).success).toBe(true);
    expect(csvUuid().safeParse(ids.join(',')).success).toBe(false);
  });
});

describe('toPageResponse', () => {
  it('wraps items and totals in the data/meta envelope', () => {
    expect(toPageResponse({ items: ['a'], total: 41 }, 3, 20)).toEqual({
      data: ['a'],
      meta: { page: 3, pageSize: 20, total: 41 },
    });
  });

  it('includes facet counts when the repository returns them', () => {
    const counts = { status: { created: 2, planned: 0 } };

    expect(toPageResponse({ items: [], total: 2, counts }, 1, 10).meta.counts).toEqual(counts);
  });

  it('computes the offset of a page', () => {
    expect(pageOffset({ page: 1, pageSize: 20 })).toBe(0);
    expect(pageOffset({ page: 3, pageSize: 20 })).toBe(40);
  });
});
