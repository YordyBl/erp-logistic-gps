import type { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { ListPaginationIndexes1794300000000 } from '../../migrations/1794300000000-ListPaginationIndexes.js';

describe('ListPaginationIndexes1794300000000', () => {
  it('creates the list indexes with their default sort order and drops them in reverse', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const runner = { query } as unknown as QueryRunner;
    const migration = new ListPaginationIndexes1794300000000();

    await migration.up(runner);
    const created = query.mock.calls.map(([sql]) => String(sql));
    expect(created).toEqual([
      'CREATE INDEX "idx_delivery_orders_org_created" ON "delivery_orders" ("organization_id", "created_at" DESC, "id")',
      'CREATE INDEX "idx_delivery_orders_org_status" ON "delivery_orders" ("organization_id", "status")',
      'CREATE INDEX "idx_delivery_orders_org_customer" ON "delivery_orders" ("organization_id", "customer_id")',
      'CREATE INDEX "idx_customers_org_created" ON "customers" ("organization_id", "created_at" DESC, "id")',
      'CREATE INDEX "idx_delivery_routes_org_planned" ON "delivery_routes" ("organization_id", "planned_date" DESC, "created_at" DESC, "id")',
    ]);

    query.mockClear();
    await migration.down(runner);
    expect(query.mock.calls.map(([sql]) => String(sql))).toEqual([
      'DROP INDEX "idx_delivery_routes_org_planned"',
      'DROP INDEX "idx_customers_org_created"',
      'DROP INDEX "idx_delivery_orders_org_customer"',
      'DROP INDEX "idx_delivery_orders_org_status"',
      'DROP INDEX "idx_delivery_orders_org_created"',
    ]);
  });
});
