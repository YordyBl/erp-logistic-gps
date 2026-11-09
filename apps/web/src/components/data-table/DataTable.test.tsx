/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setupUser } from '../../test/ui.js';
import { DataTable } from './DataTable.js';

interface Item { readonly id: string; readonly name: string; readonly status: string }

const data: readonly Item[] = Array.from({ length: 12 }, (_, index) => ({
  id: String(index), name: `Pedido ${String(index + 1).padStart(2, '0')}`, status: index < 2 ? 'delivered' : 'created',
}));
const columns: readonly ColumnDef<Item, unknown>[] = [
  { accessorKey: 'name', header: 'Nombre', meta: { title: 'Nombre' } },
  { accessorKey: 'status', header: 'Estado', filterFn: 'arrIncludesSome', meta: { title: 'Estado' } },
];
const filters = [{ columnId: 'status', title: 'Estado', options: [{ value: 'delivered', label: 'Entregado' }, { value: 'created', label: 'Creado' }] }];

function setup(onRowClick?: (item: Item) => void) {
  render(<DataTable label="Pedidos" columns={columns} data={data} searchPlaceholder="Buscar pedido" filters={filters} pageSize={5}
    {...(onRowClick === undefined ? {} : { onRowClick })} />);
  return setupUser();
}

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

afterEach(cleanup);

describe('DataTable', () => {
  it('paginates and moves between pages', async () => {
    const user = setup();

    expect(bodyRows()).toHaveLength(5);
    expect(screen.getByText('Página 1 de 3')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Página anterior' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(screen.getByText('Página 2 de 3')).toBeTruthy();
    expect(screen.getByText('Pedido 06')).toBeTruthy();
  });

  it('searches across rows, reports no matches and clears', async () => {
    const user = setup();

    await user.type(screen.getByLabelText('Buscar pedido'), 'Pedido 11');
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('1 resultado')).toBeTruthy();

    await user.type(screen.getByLabelText('Buscar pedido'), 'xx');
    expect(screen.getByText('Ningún resultado coincide con la búsqueda o los filtros.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Limpiar búsqueda' }));
    expect(screen.getByText('12 resultados')).toBeTruthy();
  });

  it('filters by facet with live counts and resets', async () => {
    const user = setup();

    await user.click(screen.getByRole('button', { name: 'Estado' }));
    const option = await screen.findByRole('option', { name: /Entregado/ });
    expect(option.textContent).toContain('2');
    await user.click(option);

    expect(screen.getByText('2 resultados')).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /Limpiar/ }));
    expect(screen.getByText('12 resultados')).toBeTruthy();
  });

  it('opens the row on click but not when the click comes from a control inside it', async () => {
    const onRowClick = vi.fn();
    const withButton: readonly ColumnDef<Item, unknown>[] = [...columns, { id: 'action', cell: () => <button type="button">Acción</button> }];
    render(<DataTable label="Pedidos" columns={withButton} data={data} searchPlaceholder="Buscar" onRowClick={onRowClick} pageSize={1} />);
    const user = setupUser();

    await user.click(screen.getByRole('button', { name: 'Acción' }));
    expect(onRowClick).not.toHaveBeenCalled();
    await user.click(screen.getByText('Pedido 01'));
    expect(onRowClick).toHaveBeenCalledWith(data[0]);
  });
});
