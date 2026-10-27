import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Driver catalog (fase 1, T3).
 *
 * Creates `drivers` with per-organization unique document numbers and a foreign
 * key to `organizations`. `updated_at` is stored explicitly and constrained to be
 * at or after `created_at`, matching the aggregate's invariant.
 *
 * Reverting drops the table. Route assignments arrive in a later module, so no
 * dependent table references `drivers` yet.
 */
export class Drivers1793232001000 implements MigrationInterface {
  name = 'Drivers1793232001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "drivers" ("id" uuid NOT NULL, "organization_id" uuid NOT NULL, "full_name" character varying(120) NOT NULL, "document_number" character varying(20) NOT NULL, "phone" character varying(32) NOT NULL, "license_number" character varying(40) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "pk_drivers" PRIMARY KEY ("id"), CONSTRAINT "uq_drivers_organization_document_number" UNIQUE ("organization_id", "document_number"), CONSTRAINT "chk_drivers_status" CHECK ("status" IN ('active', 'inactive')), CONSTRAINT "chk_drivers_document_number" CHECK ("document_number" = upper("document_number")), CONSTRAINT "chk_drivers_license_number" CHECK ("license_number" = upper("license_number")), CONSTRAINT "chk_drivers_updated_at" CHECK ("updated_at" >= "created_at"), CONSTRAINT "fk_drivers_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_drivers_organization_id" ON "drivers" ("organization_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "drivers"`);
  }
}
