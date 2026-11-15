import type { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { EvidenceVaultIndex1794400000000 } from '../../migrations/1794400000000-EvidenceVaultIndex.js';

describe('EvidenceVaultIndex1794400000000', () => {
  it('creates the newest-first evidence index and drops it on revert', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const runner = { query } as unknown as QueryRunner;
    const migration = new EvidenceVaultIndex1794400000000();

    await migration.up(runner);
    expect(query.mock.calls.map(([sql]) => String(sql))).toEqual([
      'CREATE INDEX "idx_delivery_evidence_org_created" ON "delivery_evidence" ("organization_id", "created_at" DESC, "id" DESC)',
    ]);

    query.mockClear();
    await migration.down(runner);
    expect(query.mock.calls.map(([sql]) => String(sql))).toEqual([
      'DROP INDEX "idx_delivery_evidence_org_created"',
    ]);
  });
});
