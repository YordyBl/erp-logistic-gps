import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import type { QueryRunner } from 'typeorm';

import { EvidenceVaultIndex1794400000000 } from '../../migrations/1794400000000-EvidenceVaultIndex.js';

const databaseUrl = process.env['DATABASE_URL'];
const databaseDescribe = databaseUrl === undefined ? describe.skip : describe;

databaseDescribe('EvidenceVaultIndex migration in PostgreSQL', () => {
  let client: Client | undefined;
  let schema: string | undefined;

  afterEach(async () => {
    if (client !== undefined && schema !== undefined) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      await client.end();
    }
  });

  it('creates the newest-first evidence index and removes it on revert', async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    schema = `evidence_vault_${randomUUID().replaceAll('-', '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE delivery_evidence (id uuid PRIMARY KEY, organization_id uuid NOT NULL,
      created_at timestamptz NOT NULL)`);
    const runner = { query: async (sql: string) => (await client!.query(sql)).rows } as unknown as QueryRunner;
    const indexes = async () => (await client!.query(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = $1 AND indexname LIKE 'idx_%' ORDER BY indexname`,
      [schema],
    )).rows as { indexname: string; indexdef: string }[];

    await new EvidenceVaultIndex1794400000000().up(runner);

    const created = await indexes();
    expect(created.map((row) => row.indexname)).toEqual(['idx_delivery_evidence_org_created']);
    expect(created[0]?.indexdef).toContain('(organization_id, created_at DESC, id DESC)');

    await new EvidenceVaultIndex1794400000000().down(runner);

    expect(await indexes()).toEqual([]);
  });
});
