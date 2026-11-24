import type { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { UserProfileAndLastLogin1794500000000 } from '../../migrations/1794500000000-UserProfileAndLastLogin.js';

describe('UserProfileAndLastLogin1794500000000', () => {
  it('adds the name parts and last sign-in, and removes them on revert', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const runner = { query } as unknown as QueryRunner;
    const migration = new UserProfileAndLastLogin1794500000000();

    await migration.up(runner);
    expect(query.mock.calls.map(([sql]) => String(sql))).toEqual([
      'ALTER TABLE "users" ADD "first_name" varchar(60) NULL, ADD "paternal_surname" varchar(60) NULL, ADD "maternal_surname" varchar(60) NULL, ADD "last_login_at" timestamptz NULL',
      'ALTER TABLE "users" ADD CONSTRAINT "chk_users_name_complete" CHECK (("first_name" IS NULL) = ("paternal_surname" IS NULL) AND ("maternal_surname" IS NULL OR "first_name" IS NOT NULL))',
    ]);

    query.mockClear();
    await migration.down(runner);
    expect(query.mock.calls.map(([sql]) => String(sql))).toEqual([
      'ALTER TABLE "users" DROP CONSTRAINT "chk_users_name_complete"',
      'ALTER TABLE "users" DROP COLUMN "last_login_at", DROP COLUMN "maternal_surname", DROP COLUMN "paternal_surname", DROP COLUMN "first_name"',
    ]);
  });
});
