import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Optional route start location for explicit navigation and simulation geometry. */
export class DeliveryRouteOrigin1793836800000 implements MigrationInterface {
  name = 'DeliveryRouteOrigin1793836800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_routes"
      ADD COLUMN "origin_address_line" varchar(200),
      ADD COLUMN "origin_latitude" numeric(9,6),
      ADD COLUMN "origin_longitude" numeric(9,6),
      ADD CONSTRAINT "chk_delivery_routes_origin" CHECK (
        ("origin_address_line" IS NULL AND "origin_latitude" IS NULL AND "origin_longitude" IS NULL)
        OR ("origin_address_line" IS NOT NULL AND "origin_latitude" IS NOT NULL AND "origin_longitude" IS NOT NULL)
      )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_routes"
      DROP CONSTRAINT "chk_delivery_routes_origin",
      DROP COLUMN "origin_longitude",
      DROP COLUMN "origin_latitude",
      DROP COLUMN "origin_address_line"`);
  }
}
