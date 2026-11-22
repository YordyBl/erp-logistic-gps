import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records the dispatcher who planned a simulated route. Simulated routes use
 * drivers without a linked account, so this user is the audited actor of every
 * simulated transition. Existing rows stay NULL and are never simulated.
 */
export class SimulatedRouteActor1794100000000 implements MigrationInterface {
  name = 'SimulatedRouteActor1794100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_routes"
      ADD COLUMN "simulation_actor_user_id" uuid NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_routes"
      DROP COLUMN "simulation_actor_user_id"`);
  }
}
