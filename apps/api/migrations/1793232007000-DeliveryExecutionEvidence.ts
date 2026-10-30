import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable attempt and private evidence metadata; uploaded objects are never deleted here. */
export class DeliveryExecutionEvidence1793232007000 implements MigrationInterface {
  name = 'DeliveryExecutionEvidence1793232007000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "delivery_attempts" (
      "id" uuid NOT NULL PRIMARY KEY,
      "organization_id" uuid NOT NULL,
      "order_id" uuid NOT NULL,
      "route_id" uuid NOT NULL,
      "driver_id" uuid NOT NULL,
      "attempt_number" integer NOT NULL,
      "status" varchar(20) NOT NULL,
      "started_at" timestamptz NOT NULL,
      "completed_at" timestamptz,
      CONSTRAINT "uq_delivery_attempt_order_number"
        UNIQUE ("organization_id", "order_id", "attempt_number"),
      CONSTRAINT "uq_delivery_attempt_org_id" UNIQUE ("organization_id", "id"),
      CONSTRAINT "chk_delivery_attempt_number" CHECK ("attempt_number" > 0),
      CONSTRAINT "chk_delivery_attempt_status"
        CHECK ("status" IN ('in_progress', 'delivered', 'failed')),
      CONSTRAINT "fk_delivery_attempt_order" FOREIGN KEY ("organization_id", "order_id")
        REFERENCES "delivery_orders"("organization_id", "id") ON DELETE RESTRICT,
      CONSTRAINT "fk_delivery_attempt_route" FOREIGN KEY ("organization_id", "route_id")
        REFERENCES "delivery_routes"("organization_id", "id") ON DELETE RESTRICT,
      CONSTRAINT "fk_delivery_attempt_driver" FOREIGN KEY ("organization_id", "driver_id")
        REFERENCES "drivers"("organization_id", "id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE INDEX "idx_delivery_attempt_active_order" ON
      "delivery_attempts" ("organization_id", "order_id", "status")`);

    // Existing in-flight orders need an attempt row before evidence uploads become available.
    await queryRunner.query(`INSERT INTO "delivery_attempts"
      ("id", "organization_id", "order_id", "route_id", "driver_id", "attempt_number", "status", "started_at")
      SELECT md5(o."organization_id"::text || ':' || o."id"::text || ':' || r."id"::text)::uuid,
        o."organization_id", o."id", r."id", r."driver_id", 1, 'in_progress',
        COALESCE(r."started_at", o."updated_at")
      FROM "delivery_orders" o
      JOIN "delivery_routes" r ON r."organization_id"=o."organization_id"
        AND r."id"=o."active_route_id"
      WHERE o."status"='in_transit' AND r."status"='in_progress'`);

    await queryRunner.query(`CREATE TABLE "delivery_evidence" (
      "id" uuid NOT NULL PRIMARY KEY,
      "organization_id" uuid NOT NULL,
      "order_id" uuid NOT NULL,
      "attempt_id" uuid NOT NULL,
      "incident_id" uuid,
      "object_key" varchar(512) NOT NULL,
      "mime_type" varchar(32) NOT NULL,
      "byte_size" integer NOT NULL,
      "checksum" char(64) NOT NULL,
      "uploaded_by" uuid NOT NULL,
      "idempotency_key" varchar(128) NOT NULL,
      "status" varchar(20) NOT NULL,
      "created_at" timestamptz NOT NULL,
      "available_at" timestamptz,
      CONSTRAINT "uq_delivery_evidence_org_id" UNIQUE ("organization_id", "id"),
      CONSTRAINT "uq_delivery_evidence_idempotency"
        UNIQUE ("organization_id", "uploaded_by", "idempotency_key"),
      CONSTRAINT "uq_delivery_evidence_object_key" UNIQUE ("object_key"),
      CONSTRAINT "chk_delivery_evidence_status"
        CHECK ("status" IN ('pending_upload', 'available')),
      CONSTRAINT "chk_delivery_evidence_mime_type"
        CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp')),
      CONSTRAINT "chk_delivery_evidence_byte_size" CHECK ("byte_size" BETWEEN 1 AND 5000000),
      CONSTRAINT "fk_delivery_evidence_order" FOREIGN KEY ("organization_id", "order_id")
        REFERENCES "delivery_orders"("organization_id", "id") ON DELETE RESTRICT,
      CONSTRAINT "fk_delivery_evidence_attempt" FOREIGN KEY ("organization_id", "attempt_id")
        REFERENCES "delivery_attempts"("organization_id", "id") ON DELETE RESTRICT,
      CONSTRAINT "fk_delivery_evidence_uploader" FOREIGN KEY ("organization_id", "uploaded_by")
        REFERENCES "users"("organization_id", "id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE INDEX "idx_delivery_evidence_attempt" ON
      "delivery_evidence" ("organization_id", "attempt_id", "status")`);
    await queryRunner.query(`CREATE INDEX "idx_delivery_evidence_order" ON
      "delivery_evidence" ("organization_id", "order_id", "created_at")`);
  }

  async down(): Promise<void> {
    throw new Error('Delivery evidence migration is irreversible to preserve uploaded evidence');
  }
}
