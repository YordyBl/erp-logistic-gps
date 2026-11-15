import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The evidence vault lists an organization's photos newest first
 * (`created_at DESC, id DESC`); the existing evidence indexes lead with the
 * order or the attempt, so the page query would otherwise sort the tenant.
 */
export class EvidenceVaultIndex1794400000000 implements MigrationInterface {
  name = 'EvidenceVaultIndex1794400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX "idx_delivery_evidence_org_created" ON "delivery_evidence" ("organization_id", "created_at" DESC, "id" DESC)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "idx_delivery_evidence_org_created"');
  }
}
