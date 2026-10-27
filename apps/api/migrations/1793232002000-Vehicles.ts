import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vehicle catalog (fase 1, T3).
 *
 * Creates `vehicles` with per-organization unique plates, a nullable
 * `numeric(10,2)` capacity and a foreign key to `organizations`. A nullable
 * capacity means the vehicle type does not declare a payload; the check still
 * rejects zero and negative values.
 *
 * Reverting drops the table. Route assignments arrive in a later module, so no
 * dependent table references `vehicles` yet.
 */
export class Vehicles1793232002000 implements MigrationInterface {
  name = 'Vehicles1793232002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "vehicles" ("id" uuid NOT NULL, "organization_id" uuid NOT NULL, "plate" character varying(16) NOT NULL, "type" character varying(40) NOT NULL, "capacity_kg" numeric(10,2), "status" character varying(20) NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "pk_vehicles" PRIMARY KEY ("id"), CONSTRAINT "uq_vehicles_organization_plate" UNIQUE ("organization_id", "plate"), CONSTRAINT "chk_vehicles_status" CHECK ("status" IN ('active', 'inactive')), CONSTRAINT "chk_vehicles_plate" CHECK ("plate" = upper("plate")), CONSTRAINT "chk_vehicles_capacity" CHECK ("capacity_kg" IS NULL OR ("capacity_kg" > 0 AND "capacity_kg" <= 100000)), CONSTRAINT "chk_vehicles_updated_at" CHECK ("updated_at" >= "created_at"), CONSTRAINT "fk_vehicles_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_vehicles_organization_id" ON "vehicles" ("organization_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "vehicles"`);
  }
}
