import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reports aggregate one organization over a date range. The existing indexes
 * lead with the order, so period scans of attempts, incidents and order
 * history would otherwise read the whole tenant.
 */
export class ReportIndexes1794500000001 implements MigrationInterface {
  name = 'ReportIndexes1794500000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX "idx_delivery_attempts_org_completed" ON "delivery_attempts" ("organization_id", "completed_at")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_delivery_incidents_org_occurred" ON "delivery_incidents" ("organization_id", "occurred_at")',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_delivery_order_status_history_org_occurred" ON "delivery_order_status_history" ("organization_id", "occurred_at")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "idx_delivery_order_status_history_org_occurred"');
    await queryRunner.query('DROP INDEX "idx_delivery_incidents_org_occurred"');
    await queryRunner.query('DROP INDEX "idx_delivery_attempts_org_completed"');
  }
}
