import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Persist delivery outcome details and incident audit without storing image bytes. */
export class DeliveryOutcomes1793232008000 implements MigrationInterface {
  name = 'DeliveryOutcomes1793232008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_attempts"
      ADD "receiver_name" character varying(120),
      ADD "delivery_notes" character varying(500)`);
    await queryRunner.query(`CREATE TABLE "delivery_incidents" (
      "id" uuid NOT NULL,
      "organization_id" uuid NOT NULL,
      "order_id" uuid NOT NULL,
      "attempt_id" uuid NOT NULL,
      "category" varchar(32) NOT NULL,
      "description" varchar(1000) NOT NULL,
      "actor_user_id" uuid NOT NULL,
      "occurred_at" timestamptz NOT NULL,
      CONSTRAINT "pk_delivery_incidents" PRIMARY KEY ("id"),
      CONSTRAINT "uq_delivery_incidents_org_id" UNIQUE ("organization_id", "id"),
      CONSTRAINT "chk_delivery_incidents_category" CHECK ("category" IN
        ('recipient_absent', 'incorrect_address', 'delivery_refused', 'damaged_package',
         'access_restricted', 'vehicle_issue', 'other')),
      CONSTRAINT "fk_delivery_incidents_order" FOREIGN KEY ("organization_id", "order_id")
        REFERENCES "delivery_orders"("organization_id", "id") ON DELETE RESTRICT,
      CONSTRAINT "fk_delivery_incidents_attempt" FOREIGN KEY ("organization_id", "attempt_id")
        REFERENCES "delivery_attempts"("organization_id", "id") ON DELETE RESTRICT,
      CONSTRAINT "fk_delivery_incidents_actor" FOREIGN KEY ("organization_id", "actor_user_id")
        REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE INDEX "idx_delivery_incidents_order"
      ON "delivery_incidents" ("organization_id", "order_id", "occurred_at")`);
    await queryRunner.query(`ALTER TABLE "delivery_evidence"
      ADD CONSTRAINT "fk_delivery_evidence_incident"
      FOREIGN KEY ("organization_id", "incident_id")
      REFERENCES "delivery_incidents"("organization_id", "id") ON DELETE RESTRICT`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "delivery_evidence"
      DROP CONSTRAINT "fk_delivery_evidence_incident"`);
    await queryRunner.query(`DROP INDEX "public"."idx_delivery_incidents_order"`);
    await queryRunner.query(`DROP TABLE "delivery_incidents"`);
    await queryRunner.query(`ALTER TABLE "delivery_attempts"
      DROP COLUMN "delivery_notes", DROP COLUMN "receiver_name"`);
  }
}
