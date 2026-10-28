import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive one-to-one identity binding; unbound catalog drivers remain valid. */
export class DriverAccountBindings1793232005000 implements MigrationInterface {
  name = 'DriverAccountBindings1793232005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "uq_users_organization_id"
      UNIQUE ("organization_id", "id")`);
    await queryRunner.query(`CREATE TABLE "driver_accounts" (
      "driver_id" uuid NOT NULL PRIMARY KEY,
      "organization_id" uuid NOT NULL,
      "user_id" uuid NOT NULL UNIQUE,
      CONSTRAINT "fk_driver_accounts_driver" FOREIGN KEY ("organization_id", "driver_id")
        REFERENCES "drivers"("organization_id", "id") ON DELETE RESTRICT,
      CONSTRAINT "fk_driver_accounts_user" FOREIGN KEY ("organization_id", "user_id")
        REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE "driver_account_binding_history" (
      "id" uuid NOT NULL PRIMARY KEY,
      "organization_id" uuid NOT NULL,
      "driver_id" uuid NOT NULL,
      "from_user_id" uuid,
      "to_user_id" uuid,
      "actor_user_id" uuid NOT NULL,
      "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      CONSTRAINT "fk_driver_binding_history_driver" FOREIGN KEY ("organization_id", "driver_id")
        REFERENCES "drivers"("organization_id", "id") ON DELETE RESTRICT,
      CONSTRAINT "fk_driver_binding_history_actor" FOREIGN KEY ("actor_user_id")
        REFERENCES "users"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE INDEX "idx_driver_binding_history_driver" ON
      "driver_account_binding_history" ("driver_id", "occurred_at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "driver_account_binding_history"`);
    await queryRunner.query(`DROP TABLE "driver_accounts"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "uq_users_organization_id"`);
  }
}
