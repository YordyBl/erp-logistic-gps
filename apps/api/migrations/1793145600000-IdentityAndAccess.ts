import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Identity and access foundation: organizations, users and refresh tokens.
 *
 * Multi-tenancy existed only as a loose UUID column in `delivery_orders`; this
 * migration makes it a real reference. Because the development database may
 * already contain orders created before organizations existed, the migration:
 *
 * 1. creates `organizations`, `users` and `refresh_tokens`;
 * 2. backfills one placeholder organization per distinct existing
 *    `delivery_orders.organization_id` (name `Organization <first 8 chars>`);
 * 3. adds the `delivery_orders.organization_id → organizations.id` foreign key,
 *    which is valid only after step 2.
 *
 * Reverting drops the three tables and the FK. Placeholder organizations live
 * inside `organizations`, so the rollback removes the backfilled rows together
 * with the table; restoring them would recreate the same values from the orders
 * that still exist.
 *
 * Conventions follow ADR-002 §7: snake_case, UUID primary keys, `timestamptz`
 * instants, per-organization uniqueness and hashes only for secrets.
 */
export class IdentityAndAccess1793145600000 implements MigrationInterface {
  name = 'IdentityAndAccess1793145600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "organizations" ("id" uuid NOT NULL, "name" character varying(120) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "pk_organizations" PRIMARY KEY ("id"), CONSTRAINT "chk_organizations_name" CHECK (char_length(btrim("name")) BETWEEN 2 AND 120))`,
    );

    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL, "organization_id" uuid NOT NULL, "email" character varying(254) NOT NULL, "password_hash" character varying(255) NOT NULL, "role" character varying(20) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "pk_users" PRIMARY KEY ("id"), CONSTRAINT "uq_users_organization_email" UNIQUE ("organization_id", "email"), CONSTRAINT "chk_users_role" CHECK ("role" IN ('ADMIN', 'DISPATCHER', 'DRIVER')), CONSTRAINT "chk_users_status" CHECK ("status" IN ('active', 'disabled')), CONSTRAINT "chk_users_email" CHECK ("email" = lower("email")), CONSTRAINT "fk_users_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_users_organization_id" ON "users" ("organization_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL, "user_id" uuid NOT NULL, "organization_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "family_id" uuid NOT NULL, "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "pk_refresh_tokens" PRIMARY KEY ("id"), CONSTRAINT "uq_refresh_tokens_token_hash" UNIQUE ("token_hash"), CONSTRAINT "chk_refresh_tokens_expiry" CHECK ("expires_at" > "issued_at"), CONSTRAINT "fk_refresh_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "fk_refresh_tokens_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_family_id" ON "refresh_tokens" ("family_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")`,
    );

    // Step 2: one placeholder tenant per organization id that already appears
    // in delivery_orders. DISTINCT handles several orders sharing a tenant.
    await queryRunner.query(
      `INSERT INTO "organizations" ("id", "name", "created_at")
       SELECT DISTINCT "organization_id",
                       'Organization ' || left("organization_id"::text, 8),
                       now()
         FROM "delivery_orders"`,
    );

    // Step 3: the FK is safe now that every referenced organization exists.
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" ADD CONSTRAINT "fk_delivery_orders_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" DROP CONSTRAINT IF EXISTS "fk_delivery_orders_organization"`,
    );
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "organizations"`);
  }
}
