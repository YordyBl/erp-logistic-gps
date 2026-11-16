/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Page, PageParams } from '../../api/client.js';
import { useServerTable } from '../../hooks/use-server-table.js';
import { setupUser } from '../../test/ui.js';
import { SortableHeader } from './columnHelpers.js';
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

describe('DataTable in server mode', () => {
  const total = 23;
  const fetchPage = vi.fn(async (params: PageParams): Promise<Page<Item>> => {
    const pageNumber = params.page ?? 1;
    const size = params.pageSize ?? 10;
    const items = Array.from({ length: Math.max(Math.min(size, total - (pageNumber - 1) * size), 0) }, (_, index) => {
      const position = (pageNumber - 1) * size + index + 1;
      return { id: String(position), name: `Servidor ${String(position).padStart(2, '0')}`, status: 'created' };
    });
    return { data: items, meta: { page: pageNumber, pageSize: size, total, counts: { status: { created: 21, delivered: 2 } } } };
  });

  const sortable: readonly ColumnDef<Item, unknown>[] = [
    { accessorKey: 'name', header: ({ column }) => <SortableHeader column={column} title="Nombre" />, meta: { title: 'Nombre' } },
    { accessorKey: 'status', header: 'Estado', meta: { title: 'Estado' } },
  ];

  function ServerTable() {
    const table = useServerTable(fetchPage, { pageSize: 5, filterParams: { status: 'status' }, sortFields: { name: 'recipientName' } });
    return <DataTable label="Pedidos" columns={sortable} data={table.rows} searchPlaceholder="Buscar pedido" filters={filters} server={table.server} />;
  }

  afterEach(() => fetchPage.mockClear());

  it('shows the server page and total, and sends page changes as params', async () => {
    render(<ServerTable />);
    const user = setupUser();

    expect(await screen.findByText('Servidor 01')).toBeTruthy();
    expect(bodyRows()).toHaveLength(5);
    expect(screen.getByText('23 resultados')).toBeTruthy();
    expect(screen.getByText('Página 1 de 5')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(await screen.findByText('Servidor 06')).toBeTruthy();
    expect(fetchPage.mock.lastCall?.[0]).toMatchObject({ page: 2, pageSize: 5 });

    await user.click(screen.getByRole('button', { name: 'Última página' }));
    expect(await screen.findByText('Servidor 21')).toBeTruthy();
    expect(screen.getByText('Página 5 de 5')).toBeTruthy();
    expect(bodyRows()).toHaveLength(3);
  });

  it('sends the debounced search and sorting to the server instead of filtering locally', async () => {
    render(<ServerTable />);
    const user = setupUser();
    await screen.findByText('Servidor 01');

    await user.type(screen.getByLabelText('Buscar pedido'), 'Pedido 11');
    // La búsqueda no filtra en el cliente: las filas siguen siendo las de la página del servidor.
    expect(bodyRows()).toHaveLength(5);
    await waitFor(() => expect(fetchPage.mock.lastCall?.[0]).toMatchObject({ q: 'Pedido 11', page: 1 }));

    await user.click(screen.getByRole('button', { name: 'Nombre' }));
    await waitFor(() => expect(fetchPage.mock.lastCall?.[0]).toMatchObject({ sort: 'recipientName:asc' }));
    // El orden tampoco se aplica en el cliente.
    expect(bodyRows()[0]?.textContent).toContain('Servidor 01');
  });

  it('shows facet counts from the server and sends the selected values', async () => {
    render(<ServerTable />);
    const user = setupUser();
    await screen.findByText('Servidor 01');

    await user.click(screen.getByRole('button', { name: 'Estado' }));
    const option = await screen.findByRole('option', { name: /Entregado/ });
    expect(option.textContent).toContain('2');
    expect((await screen.findByRole('option', { name: /Creado/ })).textContent).toContain('21');
    await user.click(option);

    await waitFor(() => expect(fetchPage.mock.lastCall?.[0]).toMatchObject({ status: 'delivered', page: 1 }));
  });

  it('reports no matches when a filter outside the table leaves it empty', () => {
    render(<DataTable label="Rutas" columns={columns} data={[]} searchPlaceholder="Buscar" filtered />);

    expect(screen.getByText('Ningún resultado coincide con la búsqueda o los filtros.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Limpiar/ })).toBeNull();
  });
});
