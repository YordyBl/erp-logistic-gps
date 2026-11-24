import type { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { ReportIndexes1794500000001 } from '../../migrations/1794500000001-ReportIndexes.js';

describe('ReportIndexes1794500000001', () => {
  it('creates the period indexes for reports and drops them on revert', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const runner = { query } as unknown as QueryRunner;
    const migration = new ReportIndexes1794500000001();

    await migration.up(runner);
    expect(query.mock.calls.map(([sql]) => String(sql))).toEqual([
      'CREATE INDEX "idx_delivery_attempts_org_completed" ON "delivery_attempts" ("organization_id", "completed_at")',
      'CREATE INDEX "idx_delivery_incidents_org_occurred" ON "delivery_incidents" ("organization_id", "occurred_at")',
      'CREATE INDEX "idx_delivery_order_status_history_org_occurred" ON "delivery_order_status_history" ("organization_id", "occurred_at")',
    ]);

    query.mockClear();
    await migration.down(runner);
    expect(query.mock.calls.map(([sql]) => String(sql))).toEqual([
      'DROP INDEX "idx_delivery_order_status_history_org_occurred"',
      'DROP INDEX "idx_delivery_incidents_org_occurred"',
      'DROP INDEX "idx_delivery_attempts_org_completed"',
    ]);
  });
});
