/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Page, PageParams } from '../api/client.js';
import { useServerTable, type ServerTableOptions } from './use-server-table.js';

interface Item { readonly id: string }

function page(ids: readonly string[], total = ids.length, counts?: Page<Item>['meta']['counts']): Page<Item> {
  return { data: ids.map((id) => ({ id })), meta: { page: 1, pageSize: 10, total, ...(counts === undefined ? {} : { counts }) } };
}

/** Respuestas que el test resuelve cuando quiere, para comprobar el orden y la cancelación. */
function controlledFetch() {
  const calls: { params: PageParams; signal: AbortSignal; resolve: (value: Page<Item>) => void; reject: (reason: unknown) => void }[] = [];
  const fetchPage = vi.fn((params: PageParams, signal: AbortSignal) => new Promise<Page<Item>>((resolve, reject) => {
    calls.push({ params, signal, resolve, reject });
  }));
  return { fetchPage, calls };
}

function setup(options: ServerTableOptions = {}) {
  const fetch = controlledFetch();
  const hook = renderHook(() => useServerTable(fetch.fetchPage, options));
  return { ...fetch, hook };
}

async function settle(call: { resolve: (value: Page<Item>) => void } | undefined, value: Page<Item>) {
  await act(async () => { call?.resolve(value); });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useServerTable', () => {
  it('requests the first page and exposes rows, meta and facet counts by column', async () => {
    const { calls, hook } = setup({ filterParams: { estado: 'status' } });

    expect(hook.result.current.loading).toBe(true);
    expect(calls[0]?.params).toEqual({ page: 1, pageSize: 10 });
    await settle(calls[0], page(['a', 'b'], 12, { status: { created: 12 } }));

    expect(hook.result.current.rows).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(hook.result.current.meta?.total).toBe(12);
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.server.rowCount).toBe(12);
    expect(hook.result.current.server.facetCounts).toEqual({ status: { created: 12 }, estado: { created: 12 } });
  });

  it('maps sorting and column filters to server params', async () => {
    const { calls, hook } = setup({ sortFields: { code: 'publicCode' }, filterParams: { estado: 'status' }, params: { customerId: 'c-1' } });
    await settle(calls[0], page([]));

    act(() => {
      hook.result.current.handlers.onSortingChange([{ id: 'code', desc: true }]);
      hook.result.current.handlers.onColumnFiltersChange([{ id: 'estado', value: ['created', 'planned'] }, { id: 'timeWindow', value: ['AM'] }]);
    });

    expect(calls.at(-1)?.params).toEqual({
      customerId: 'c-1', status: 'created,planned', timeWindow: 'AM', page: 1, pageSize: 10, sort: 'publicCode:desc',
    });
  });

  it('waits 300 ms after the last keystroke and returns to the first page', async () => {
    const { calls, hook } = setup();
    await settle(calls[0], page(['a'], 50));
    act(() => hook.result.current.handlers.onPaginationChange({ pageIndex: 2, pageSize: 10 }));
    expect(calls.at(-1)?.params.page).toBe(3);
    await settle(calls.at(-1), page(['c'], 50));
    const before = calls.length;

    act(() => hook.result.current.handlers.onGlobalFilterChange('an'));
    act(() => { vi.advanceTimersByTime(200); });
    act(() => hook.result.current.handlers.onGlobalFilterChange(' ana '));
    act(() => { vi.advanceTimersByTime(299); });
    expect(calls).toHaveLength(before);
    expect(hook.result.current.server.loading).toBe(true);

    act(() => { vi.advanceTimersByTime(1); });

    expect(calls).toHaveLength(before + 1);
    expect(calls.at(-1)?.params).toEqual({ page: 1, pageSize: 10, q: 'ana' });
    expect(hook.result.current.state.pagination.pageIndex).toBe(0);
  });

  it('returns to the first page when filters, sorting or page size change', async () => {
    const { calls, hook } = setup();
    await settle(calls[0], page(['a'], 50));

    for (const change of [
      () => hook.result.current.handlers.onColumnFiltersChange([{ id: 'status', value: ['created'] }]),
      () => hook.result.current.handlers.onSortingChange([{ id: 'createdAt', desc: false }]),
      () => hook.result.current.handlers.onPaginationChange((current) => ({ ...current, pageSize: 20 })),
    ]) {
      act(() => hook.result.current.handlers.onPaginationChange((current) => ({ ...current, pageIndex: 3 })));
      expect(calls.at(-1)?.params.page).toBe(4);
      act(change);
      expect(calls.at(-1)?.params.page).toBe(1);
      expect(hook.result.current.state.pagination.pageIndex).toBe(0);
    }
  });

  it('cancels the previous request and ignores its late response', async () => {
    const { calls, hook } = setup();
    act(() => hook.result.current.handlers.onPaginationChange({ pageIndex: 1, pageSize: 10 }));

    expect(calls[0]?.signal.aborted).toBe(true);
    await settle(calls[1], page(['new'], 20));
    await settle(calls[0], page(['old'], 20));

    expect(hook.result.current.rows).toEqual([{ id: 'new' }]);
  });

  it('keeps the rows, reports the error and recovers on reload', async () => {
    const { calls, hook } = setup();
    await settle(calls[0], page(['a']));

    act(() => hook.result.current.reload());
    await act(async () => { calls[1]?.reject(new Error('Sin conexión')); });

    expect(hook.result.current.error?.message).toBe('Sin conexión');
    expect(hook.result.current.rows).toEqual([{ id: 'a' }]);
    expect(hook.result.current.loading).toBe(false);

    act(() => hook.result.current.reload());
    expect(calls[2]?.params).toEqual({ page: 1, pageSize: 10 });
    await settle(calls[2], page(['b']));
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.rows).toEqual([{ id: 'b' }]);
  });

  it('moves to the last page when the current one no longer exists', async () => {
    const { calls, hook } = setup();
    await settle(calls[0], page(['a'], 30));
    act(() => hook.result.current.handlers.onPaginationChange({ pageIndex: 2, pageSize: 10 }));

    await settle(calls.at(-1), page([], 15));

    expect(hook.result.current.state.pagination.pageIndex).toBe(1);
    expect(calls.at(-1)?.params.page).toBe(2);
  });
});
