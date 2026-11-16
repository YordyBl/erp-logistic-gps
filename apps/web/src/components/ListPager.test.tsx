/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setupUser } from '../test/ui.js';
import { ListPager } from './ListPager.js';

function table(total: number, pageIndex = 0, pageSize = 10) {
  return {
    meta: { page: pageIndex + 1, pageSize, total },
    state: { pagination: { pageIndex, pageSize }, sorting: [], globalFilter: '', columnFilters: [] },
    handlers: {
      onPaginationChange: vi.fn(), onSortingChange: vi.fn(), onGlobalFilterChange: vi.fn(), onColumnFiltersChange: vi.fn(),
    },
    loading: false,
  };
}

afterEach(cleanup);

describe('ListPager', () => {
  it('stays visible on a single page with both buttons disabled', () => {
    render(<ListPager table={table(7)} label="conductores" />);

    expect(screen.getByText('Mostrando 1–7 de 7')).toBeTruthy();
    expect(screen.getByText('Página 1 de 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Página anterior de conductores' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Página siguiente de conductores' })).toHaveProperty('disabled', true);
  });

  it('shows the range of the current page and moves between pages', async () => {
    const user = setupUser();
    const pager = table(23, 2);
    render(<ListPager table={pager} label="vehículos" />);

    expect(screen.getByText('Mostrando 21–23 de 23')).toBeTruthy();
    expect(screen.getByText('Página 3 de 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Página siguiente de vehículos' })).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('button', { name: 'Página anterior de vehículos' }));
    expect(pager.handlers.onPaginationChange).toHaveBeenCalledOnce();
  });

  it('renders nothing when there are no rows', () => {
    const { container } = render(<ListPager table={table(0)} label="vehículos" />);
    expect(container.textContent).toBe('');
  });
});
