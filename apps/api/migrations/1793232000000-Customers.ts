import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customer catalog (fase 1, T3).
 *
 * Creates `customers` with per-organization unique public codes and a foreign
 * key to `organizations`. Conventions follow ADR-002 §7: snake_case, UUID
 * primary keys, `timestamptz` instants, hashes only for secrets.
 *
 * Reverting drops the table. Customer rows are catalog data referenced by no
 * other table in this milestone, so the rollback needs no dependent cleanup.
 */
export class Customers1793232000000 implements MigrationInterface {
  name = 'Customers1793232000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "customers" ("id" uuid NOT NULL, "organization_id" uuid NOT NULL, "public_code" character varying(32) NOT NULL, "name" character varying(120) NOT NULL, "contact_name" character varying(120) NOT NULL, "contact_email" character varying(254) NOT NULL, "contact_phone" character varying(32) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "pk_customers" PRIMARY KEY ("id"), CONSTRAINT "uq_customers_organization_public_code" UNIQUE ("organization_id", "public_code"), CONSTRAINT "chk_customers_status" CHECK ("status" IN ('active', 'inactive')), CONSTRAINT "chk_customers_public_code" CHECK ("public_code" = upper("public_code")), CONSTRAINT "chk_customers_contact_email" CHECK ("contact_email" = lower("contact_email")), CONSTRAINT "fk_customers_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_customers_organization_id" ON "customers" ("organization_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "customers"`);
  }
}
