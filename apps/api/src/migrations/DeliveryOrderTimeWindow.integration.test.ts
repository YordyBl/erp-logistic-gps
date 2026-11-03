import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import type { QueryRunner } from 'typeorm';

import { DeliveryOrderTimeWindow1793664000000 } from '../../migrations/1793664000000-DeliveryOrderTimeWindow.js';

const databaseUrl = process.env['DATABASE_URL'];
const databaseDescribe = databaseUrl === undefined ? describe.skip : describe;

databaseDescribe('DeliveryOrderTimeWindow migration in PostgreSQL', () => {
  let client: Client | undefined;
  let schema: string | undefined;

  afterEach(async () => {
    if (client !== undefined && schema !== undefined) {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      await client.end();
    }
  });

  it('refuses nonempty orders without changing their stored data or schema', async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    schema = `time_window_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query('CREATE TABLE delivery_orders (id uuid PRIMARY KEY, organization_id uuid NOT NULL)');
    await client.query(
      `INSERT INTO delivery_orders (id, organization_id)
       VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111')`,
    );
    await client.query('BEGIN');

    const hash = async () => (await client!.query(
      `SELECT md5(string_agg(row_to_json(order_row)::text, '' ORDER BY id)) AS value
       FROM delivery_orders AS order_row`,
    )).rows[0]?.['value'];
    const beforeHash = await hash();
    const runner = {
      query: async (sql: string) => (await client!.query(sql)).rows,
    };

    await expect(new DeliveryOrderTimeWindow1793664000000().up(runner as unknown as QueryRunner))
      .rejects.toThrow('1 delivery orders exist; assign a verified AM/PM window before applying this migration');

    expect(await hash()).toBe(beforeHash);
    const columns = await client.query(
      `SELECT count(*)::int AS count FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'delivery_orders' AND column_name = 'time_window'`,
      [schema],
    );
    expect(columns.rows[0]?.['count']).toBe(0);
  });
});
