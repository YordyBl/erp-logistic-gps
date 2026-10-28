import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Route start and its order transitions are recorded in the same transaction. */
export class DeliveryRouteStatusHistory1793232006000 implements MigrationInterface {
  name = 'DeliveryRouteStatusHistory1793232006000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "delivery_route_status_history" (
      "id" uuid NOT NULL PRIMARY KEY,
      "organization_id" uuid NOT NULL,
      "route_id" uuid NOT NULL,
      "from_status" varchar(20) NOT NULL,
      "to_status" varchar(20) NOT NULL,
      "actor_user_id" uuid NOT NULL,
      "occurred_at" timestamptz NOT NULL,
      CONSTRAINT "fk_route_status_history_route" FOREIGN KEY ("organization_id", "route_id")
        REFERENCES "delivery_routes"("organization_id", "id") ON DELETE RESTRICT,
      CONSTRAINT "fk_route_status_history_actor" FOREIGN KEY ("organization_id", "actor_user_id")
        REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE INDEX "idx_route_status_history_route" ON
      "delivery_route_status_history" ("route_id", "occurred_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "delivery_route_status_history"`);
  }
}
