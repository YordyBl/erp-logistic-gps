import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Require explicit AM/PM selection without fabricating values for legacy orders. */
export class DeliveryOrderTimeWindow1793664000000 implements MigrationInterface {
  name = 'DeliveryOrderTimeWindow1793664000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('LOCK TABLE "delivery_orders" IN ACCESS EXCLUSIVE MODE');
    const rows = (await queryRunner.query('SELECT count(*)::text AS count FROM "delivery_orders"')) as
      { count: string }[];
    const count = Number(rows[0]?.count ?? 0);
    if (count > 0) {
      throw new Error(
        `${count} delivery orders exist; assign a verified AM/PM window before applying this migration`,
      );
    }

    await queryRunner.query(`ALTER TABLE "delivery_orders"
      ADD "time_window" varchar(2) NOT NULL,
      ADD CONSTRAINT "chk_delivery_orders_time_window" CHECK ("time_window" IN ('AM', 'PM'))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_orders"
      DROP CONSTRAINT "chk_delivery_orders_time_window",
      DROP COLUMN "time_window"`);
  }
}
