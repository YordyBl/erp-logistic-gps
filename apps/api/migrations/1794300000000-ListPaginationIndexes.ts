import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Indexes behind server-side pagination: each list sorts by its default order
 * inside one organization and filters orders by status or customer, so the
 * page query and its facet counts avoid scanning the whole tenant.
 */
const INDEXES = [
  ['idx_delivery_orders_org_created', '"delivery_orders" ("organization_id", "created_at" DESC, "id")'],
  ['idx_delivery_orders_org_status', '"delivery_orders" ("organization_id", "status")'],
  ['idx_delivery_orders_org_customer', '"delivery_orders" ("organization_id", "customer_id")'],
  ['idx_customers_org_created', '"customers" ("organization_id", "created_at" DESC, "id")'],
  ['idx_delivery_routes_org_planned', '"delivery_routes" ("organization_id", "planned_date" DESC, "created_at" DESC, "id")'],
] as const;

export class ListPaginationIndexes1794300000000 implements MigrationInterface {
  name = 'ListPaginationIndexes1794300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, target] of INDEXES) {
      await queryRunner.query(`CREATE INDEX "${name}" ON ${target}`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const [name] of [...INDEXES].reverse()) {
      await queryRunner.query(`DROP INDEX "${name}"`);
    }
  }
}
