import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Existing routes remain ineligible until explicitly opted in for simulation completion. */
export class SimulatedRouteCompletionOptIn1793923200000 implements MigrationInterface {
  name = 'SimulatedRouteCompletionOptIn1793923200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_routes"
      ADD COLUMN "simulated_completion_enabled" boolean NOT NULL DEFAULT false`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_routes"
      DROP COLUMN "simulated_completion_enabled"`);
  }
}
