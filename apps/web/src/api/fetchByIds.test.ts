import { describe, expect, it, vi } from 'vitest';

import type { Page, PageParams } from './client.js';
import { fetchByIds, IDS_CHUNK_SIZE } from './fetchByIds.js';

function pageOf(ids: readonly string[]): Page<{ readonly id: string }> {
  return { data: ids.map((id) => ({ id })), meta: { page: 1, pageSize: IDS_CHUNK_SIZE, total: ids.length } };
}

describe('fetchByIds', () => {
  it('asks for unique ids in chunks of the maximum page size and joins the rows', async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `id-${index}`);
    const fetchPage = vi.fn(async (params: PageParams) => pageOf(params['ids'] as string[]));
    const controller = new AbortController();

    const rows = await fetchByIds(fetchPage, [...ids, 'id-0', 'id-149'], controller.signal);

    expect(rows.map((row) => row.id)).toEqual(ids);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, { ids: ids.slice(0, 100), pageSize: 100 }, controller.signal);
    expect(fetchPage).toHaveBeenNthCalledWith(2, { ids: ids.slice(100), pageSize: 100 }, controller.signal);
  });

  it('does not call the API without ids', async () => {
    const fetchPage = vi.fn();

    await expect(fetchByIds(fetchPage, [])).resolves.toEqual([]);
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
