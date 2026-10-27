import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive, append-only audit storage; existing order rows remain unchanged. */
export class DeliveryOrderStatusHistory1793232003000 implements MigrationInterface {
  name = 'DeliveryOrderStatusHistory1793232003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "delivery_order_status_history" ("id" uuid NOT NULL, "order_id" uuid NOT NULL, "organization_id" uuid NOT NULL, "from_status" character varying(20) NOT NULL, "to_status" character varying(20) NOT NULL, "actor_user_id" uuid NOT NULL, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_delivery_order_status_history" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_delivery_order_status_history_order" ON "delivery_order_status_history" ("order_id", "occurred_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_order_status_history" ADD CONSTRAINT "FK_delivery_order_status_history_order" FOREIGN KEY ("order_id") REFERENCES "delivery_orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_order_status_history" DROP CONSTRAINT "FK_delivery_order_status_history_order"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_delivery_order_status_history_order"`);
    await queryRunner.query(`DROP TABLE "delivery_order_status_history"`);
  }
}
