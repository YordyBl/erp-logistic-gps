import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import type { QueryRunner } from 'typeorm';

import { ListPaginationIndexes1794300000000 } from '../../migrations/1794300000000-ListPaginationIndexes.js';

const databaseUrl = process.env['DATABASE_URL'];
const databaseDescribe = databaseUrl === undefined ? describe.skip : describe;

databaseDescribe('ListPaginationIndexes migration in PostgreSQL', () => {
  let client: Client | undefined;
  let schema: string | undefined;

  afterEach(async () => {
    if (client !== undefined && schema !== undefined) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      await client.end();
    }
  });

  it('creates the pagination indexes and removes them on revert', async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    schema = `list_indexes_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE delivery_orders (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
      customer_id uuid NOT NULL, status varchar(20) NOT NULL, created_at timestamptz NOT NULL)`);
    await client.query(`CREATE TABLE customers (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
      created_at timestamptz NOT NULL)`);
    await client.query(`CREATE TABLE delivery_routes (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
      planned_date date NOT NULL, created_at timestamptz NOT NULL)`);
    const runner = { query: async (sql: string) => (await client!.query(sql)).rows } as unknown as QueryRunner;
    const indexes = async () => (await client!.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = $1 AND indexname LIKE 'idx_%' ORDER BY indexname`,
      [schema],
    )).rows as { indexname: string; indexdef: string }[];

    await new ListPaginationIndexes1794300000000().up(runner);

    const created = await indexes();
    expect(created.map((row) => row.indexname)).toEqual([
      'idx_customers_org_created',
      'idx_delivery_orders_org_created',
      'idx_delivery_orders_org_customer',
      'idx_delivery_orders_org_status',
      'idx_delivery_routes_org_planned',
    ]);
    expect(created.find((row) => row.indexname === 'idx_delivery_routes_org_planned')?.indexdef)
      .toContain('(organization_id, planned_date DESC, created_at DESC, id)');

    await new ListPaginationIndexes1794300000000().down(runner);

    expect(await indexes()).toEqual([]);
  });
});
