import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for the delivery-orders pilot.
 *
 * Reviewed after generation with the TypeORM CLI. Conventions (ADR-002 §7):
 * snake_case columns, UUID primary keys, per-organization unique public codes
 * and `timestamptz` instants. The session timezone (America/Lima) is set by the
 * data source and by compose; it never changes the stored instant.
 *
 * The package table is a child of the order aggregate: rows cascade with their
 * order, and `position` preserves the aggregate's package order on reload.
 */
export class InitialDeliveryOrders1793073274116 implements MigrationInterface {
  name = 'InitialDeliveryOrders1793073274116';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "delivery_order_packages" ("id" uuid NOT NULL, "delivery_order_id" uuid NOT NULL, "position" integer NOT NULL, "code" character varying(40) NOT NULL, "description" character varying(200) NOT NULL, "weight_kg" numeric(10,3), CONSTRAINT "uq_delivery_order_packages_order_code" UNIQUE ("delivery_order_id", "code"), CONSTRAINT "chk_delivery_order_packages_position" CHECK ("position" >= 0), CONSTRAINT "chk_delivery_order_packages_weight_kg" CHECK ("weight_kg" IS NULL OR ("weight_kg" > 0 AND "weight_kg" <= 1000)), CONSTRAINT "PK_8cee256c487cbd298511822532f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "delivery_orders" ("id" uuid NOT NULL, "organization_id" uuid NOT NULL, "public_code" character varying(32) NOT NULL, "recipient_name" character varying(120) NOT NULL, "recipient_phone" character varying(20) NOT NULL, "delivery_address_line" character varying(200) NOT NULL, "delivery_district" character varying(80) NOT NULL, "latitude" numeric(9,6), "longitude" numeric(9,6), "status" character varying(20) NOT NULL DEFAULT 'created', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "uq_delivery_orders_organization_public_code" UNIQUE ("organization_id", "public_code"), CONSTRAINT "chk_delivery_orders_longitude" CHECK ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180)), CONSTRAINT "chk_delivery_orders_latitude" CHECK ("latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90)), CONSTRAINT "chk_delivery_orders_coordinates" CHECK (("latitude" IS NULL) = ("longitude" IS NULL)), CONSTRAINT "chk_delivery_orders_public_code" CHECK ("public_code" ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'), CONSTRAINT "chk_delivery_orders_status" CHECK ("status" IN ('created', 'planned', 'assigned', 'in_transit', 'delivered', 'returned', 'cancelled')), CONSTRAINT "PK_29e637736a0b5f36946edec3650" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_delivery_orders_organization_id" ON "delivery_orders" ("organization_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_order_packages" ADD CONSTRAINT "FK_f6d6456ccad03c43caede636e6c" FOREIGN KEY ("delivery_order_id") REFERENCES "delivery_orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_order_packages" DROP CONSTRAINT "FK_f6d6456ccad03c43caede636e6c"`,
    );
    await queryRunner.query(`DROP TABLE "delivery_order_packages"`);
    await queryRunner.query(`DROP INDEX "public"."idx_delivery_orders_organization_id"`);
    await queryRunner.query(`DROP TABLE "delivery_orders"`);
  }
}
