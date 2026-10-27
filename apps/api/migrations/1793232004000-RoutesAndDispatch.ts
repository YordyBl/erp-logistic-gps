import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive route planning schema; existing orders retain their status and data. */
export class RoutesAndDispatch1793232004000 implements MigrationInterface {
  name = 'RoutesAndDispatch1793232004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite keys make tenant ownership a database invariant, not just an API check.
    await queryRunner.query(`ALTER TABLE "drivers" ADD CONSTRAINT "uq_drivers_organization_id" UNIQUE ("organization_id", "id")`);
    await queryRunner.query(`ALTER TABLE "vehicles" ADD CONSTRAINT "uq_vehicles_organization_id" UNIQUE ("organization_id", "id")`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" ADD CONSTRAINT "uq_delivery_orders_organization_id" UNIQUE ("organization_id", "id")`);
    await queryRunner.query(`CREATE TABLE "delivery_routes" (
      "id" uuid NOT NULL, "organization_id" uuid NOT NULL,
      "public_code" character varying(32) NOT NULL, "planned_date" date NOT NULL,
      "driver_id" uuid NOT NULL, "vehicle_id" uuid NOT NULL,
      "status" character varying(20) NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "started_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE,
      CONSTRAINT "PK_delivery_routes" PRIMARY KEY ("id"),
      CONSTRAINT "uq_delivery_routes_organization_id" UNIQUE ("organization_id", "id"),
      CONSTRAINT "uq_delivery_routes_organization_public_code" UNIQUE ("organization_id", "public_code"),
      CONSTRAINT "chk_delivery_routes_status" CHECK ("status" IN ('planned', 'in_progress', 'completed', 'cancelled'))
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_delivery_routes_active_driver" ON "delivery_routes" ("driver_id") WHERE "status" IN ('planned', 'in_progress')`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_delivery_routes_active_vehicle" ON "delivery_routes" ("vehicle_id") WHERE "status" IN ('planned', 'in_progress')`);
    await queryRunner.query(`ALTER TABLE "delivery_routes" ADD CONSTRAINT "FK_delivery_routes_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE "delivery_routes" ADD CONSTRAINT "FK_delivery_routes_driver" FOREIGN KEY ("organization_id", "driver_id") REFERENCES "drivers"("organization_id", "id") ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE "delivery_routes" ADD CONSTRAINT "FK_delivery_routes_vehicle" FOREIGN KEY ("organization_id", "vehicle_id") REFERENCES "vehicles"("organization_id", "id") ON DELETE RESTRICT`);

    await queryRunner.query(`CREATE TABLE "delivery_stops" (
      "id" uuid NOT NULL, "organization_id" uuid NOT NULL,
      "route_id" uuid NOT NULL, "sequence" integer NOT NULL,
      "address_line" character varying(200) NOT NULL,
      "latitude" numeric(9,6), "longitude" numeric(9,6),
      "status" character varying(20) NOT NULL DEFAULT 'pending',
      "planned_arrival_at" TIMESTAMP WITH TIME ZONE,
      CONSTRAINT "PK_delivery_stops" PRIMARY KEY ("id"),
      CONSTRAINT "uq_delivery_stops_organization_route_id" UNIQUE ("organization_id", "route_id", "id"),
      CONSTRAINT "uq_delivery_stops_route_sequence" UNIQUE ("route_id", "sequence"),
      CONSTRAINT "chk_delivery_stops_sequence" CHECK ("sequence" > 0),
      CONSTRAINT "chk_delivery_stops_coordinates" CHECK (("latitude" IS NULL) = ("longitude" IS NULL))
    )`);
    await queryRunner.query(`ALTER TABLE "delivery_stops" ADD CONSTRAINT "FK_delivery_stops_route" FOREIGN KEY ("organization_id", "route_id") REFERENCES "delivery_routes"("organization_id", "id") ON DELETE RESTRICT`);

    await queryRunner.query(`CREATE TABLE "delivery_stop_orders" (
      "id" uuid NOT NULL, "organization_id" uuid NOT NULL,
      "route_id" uuid NOT NULL, "stop_id" uuid NOT NULL, "order_id" uuid NOT NULL,
      "position" integer NOT NULL,
      "active" boolean NOT NULL DEFAULT true,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      CONSTRAINT "PK_delivery_stop_orders" PRIMARY KEY ("id"),
      CONSTRAINT "uq_delivery_stop_orders_stop_position" UNIQUE ("stop_id", "position"),
      CONSTRAINT "chk_delivery_stop_orders_position" CHECK ("position" >= 0)
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_delivery_stop_orders_active_order" ON "delivery_stop_orders" ("order_id") WHERE "active" = true`);
    await queryRunner.query(`ALTER TABLE "delivery_stop_orders" ADD CONSTRAINT "FK_delivery_stop_orders_route" FOREIGN KEY ("organization_id", "route_id") REFERENCES "delivery_routes"("organization_id", "id") ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE "delivery_stop_orders" ADD CONSTRAINT "FK_delivery_stop_orders_stop" FOREIGN KEY ("organization_id", "route_id", "stop_id") REFERENCES "delivery_stops"("organization_id", "route_id", "id") ON DELETE RESTRICT`);
    await queryRunner.query(`ALTER TABLE "delivery_stop_orders" ADD CONSTRAINT "FK_delivery_stop_orders_order" FOREIGN KEY ("organization_id", "order_id") REFERENCES "delivery_orders"("organization_id", "id") ON DELETE RESTRICT`);

    await queryRunner.query(`ALTER TABLE "delivery_orders" ADD "active_route_id" uuid`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" ADD CONSTRAINT "FK_delivery_orders_active_route" FOREIGN KEY ("organization_id", "active_route_id") REFERENCES "delivery_routes"("organization_id", "id") ON DELETE RESTRICT`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP CONSTRAINT "FK_delivery_orders_active_route"`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP COLUMN "active_route_id"`);
    await queryRunner.query(`DROP TABLE "delivery_stop_orders"`);
    await queryRunner.query(`DROP TABLE "delivery_stops"`);
    await queryRunner.query(`DROP TABLE "delivery_routes"`);
    await queryRunner.query(`ALTER TABLE "delivery_orders" DROP CONSTRAINT "uq_delivery_orders_organization_id"`);
    await queryRunner.query(`ALTER TABLE "vehicles" DROP CONSTRAINT "uq_vehicles_organization_id"`);
    await queryRunner.query(`ALTER TABLE "drivers" DROP CONSTRAINT "uq_drivers_organization_id"`);
  }
}
