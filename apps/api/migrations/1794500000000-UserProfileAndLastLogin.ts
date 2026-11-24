import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * User names (nombres, apellido paterno, apellido materno) and last sign-in.
 *
 * The name columns are nullable only for accounts created before this
 * migration: no name is invented for them, the web asks an ADMIN to complete
 * it. New and edited accounts always carry nombres and apellido paterno, and
 * `chk_users_name_complete` keeps those two together. `last_login_at` is set by
 * the login use case; NULL means the account never signed in.
 */
export class UserProfileAndLastLogin1794500000000 implements MigrationInterface {
  name = 'UserProfileAndLastLogin1794500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "users" ADD "first_name" varchar(60) NULL, ADD "paternal_surname" varchar(60) NULL, ADD "maternal_surname" varchar(60) NULL, ADD "last_login_at" timestamptz NULL',
    );
    await queryRunner.query(
      'ALTER TABLE "users" ADD CONSTRAINT "chk_users_name_complete" CHECK (("first_name" IS NULL) = ("paternal_surname" IS NULL) AND ("maternal_surname" IS NULL OR "first_name" IS NOT NULL))',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "users" DROP CONSTRAINT "chk_users_name_complete"');
    await queryRunner.query(
      'ALTER TABLE "users" DROP COLUMN "last_login_at", DROP COLUMN "maternal_surname", DROP COLUMN "paternal_surname", DROP COLUMN "first_name"',
    );
  }
}
