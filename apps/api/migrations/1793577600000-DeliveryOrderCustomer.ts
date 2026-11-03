import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Add a required, tenant-safe customer reference to delivery orders. */
export class DeliveryOrderCustomer1793577600000 implements MigrationInterface {
  name = 'DeliveryOrderCustomer1793577600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`LOCK TABLE "delivery_orders" IN ACCESS EXCLUSIVE MODE`);
    const rows = await queryRunner.query(
      `SELECT count(*)::text AS count FROM "delivery_orders"`,
    ) as { count: string }[];
    const count = rows[0]?.count ?? '0';
    if (count !== '0') {
      throw new Error(
        `Cannot require customer_id: ${count} delivery orders exist. Assign each order to a verified customer before applying this migration. No order data was changed.`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "customers" ADD CONSTRAINT "uq_customers_organization_id_id" UNIQUE ("organization_id", "id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" ADD "customer_id" uuid NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" ADD CONSTRAINT "fk_delivery_orders_customer_tenant" FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" DROP CONSTRAINT "fk_delivery_orders_customer_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" DROP COLUMN "customer_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers" DROP CONSTRAINT "uq_customers_organization_id_id"`,
    );
  }
}
