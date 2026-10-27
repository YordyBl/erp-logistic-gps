import { randomUUID } from 'node:crypto';

import type { DataSource, QueryRunner } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDataSource } from '../../../../infrastructure/database/data-source.js';
import { IdentityAndAccess1793145600000 } from '../../../../../migrations/1793145600000-IdentityAndAccess.js';
import { probeIdentityDatabase } from '../../tests/support/test-database.js';

const database = await probeIdentityDatabase();

if (!database.available) {
  process.stderr.write(
    `[identity-and-access:migration] Skipping migration backfill tests: ${database.reason}. ` +
      'Start the compose PostgreSQL service and set DATABASE_URL to run them.\n',
  );
}

const databaseUrl = database.available ? database.url : null;

interface QueryFailedErrorLike {
  readonly driverError?: { readonly code?: string };
  readonly code?: string;
}

async function expectPostgresError(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  const error: unknown = await operation.catch((cause: unknown) => cause);
  const carrier = error as QueryFailedErrorLike;
  expect(carrier.driverError?.code ?? carrier.code).toBe(code);
}

/**
 * Runs migration 2 in an isolated schema that already contains the migration-1
 * `delivery_orders` table with rows for organizations that do not exist yet.
 *
 * A throwaway schema is used because the shared database has already applied
 * both migrations; reverting them would destroy real development rows. The
 * schema is dropped in a `finally` block and the connection's `search_path` is
 * restored before the runner returns to the pool.
 */
describe.skipIf(databaseUrl === null)(
  'IdentityAndAccess migration backfill (PostgreSQL)',
  () => {
    let dataSource: DataSource | undefined;
    let queryRunner: QueryRunner | undefined;
    let schemaName: string | undefined;

    beforeAll(async () => {
      if (databaseUrl === null) {
        return;
      }

      dataSource = createDataSource({ url: databaseUrl });
      await dataSource.initialize();
      queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();

      schemaName = `identity_migration_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      await queryRunner.query(`CREATE SCHEMA "${schemaName}"`);
      await queryRunner.query(`SET search_path TO "${schemaName}"`);
    });

    afterAll(async () => {
      if (queryRunner !== undefined) {
        await queryRunner.query('RESET search_path').catch(() => undefined);
        if (schemaName !== undefined) {
          await queryRunner
            .query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
            .catch(() => undefined);
        }
        await queryRunner.release();
      }

      if (dataSource !== undefined && dataSource.isInitialized) {
        await dataSource.destroy();
      }
    });

    function runner(): QueryRunner {
      if (queryRunner === undefined) {
        throw new Error('The migration test query runner was not initialized');
      }

      return queryRunner;
    }

    it('backfills one organization per existing delivery_orders organization and adds its FK', async () => {
      const firstOrganizationId = randomUUID();
      const secondOrganizationId = randomUUID();

      await runner().query(
        `CREATE TABLE "delivery_orders" (
           "id" uuid NOT NULL,
           "organization_id" uuid NOT NULL,
           CONSTRAINT "pk_delivery_orders" PRIMARY KEY ("id")
         )`,
      );
      await runner().query(
        `INSERT INTO "delivery_orders" ("id", "organization_id")
         VALUES ($1, $2), ($3, $2), ($4, $5)`,
        [
          randomUUID(),
          firstOrganizationId,
          randomUUID(),
          randomUUID(),
          secondOrganizationId,
        ],
      );

      await new IdentityAndAccess1793145600000().up(runner());

      const organizations = (await runner().query(
        'SELECT "id", "name", "created_at" FROM "organizations" ORDER BY "name"',
      )) as Array<{ id: string; name: string; created_at: Date }>;

      expect(organizations).toHaveLength(2);
      expect(organizations.map((row) => row.id).sort()).toEqual(
        [firstOrganizationId, secondOrganizationId].sort(),
      );
      for (const row of organizations) {
        expect(row.name).toBe(`Organization ${row.id.slice(0, 8)}`);
        expect(row.created_at).toBeInstanceOf(Date);
      }

      // The backfilled organizations satisfy the new foreign key for existing
      // rows and for new ones.
      await expect(
        runner().query(
          `INSERT INTO "delivery_orders" ("id", "organization_id") VALUES ($1, $2)`,
          [randomUUID(), firstOrganizationId],
        ),
      ).resolves.toBeDefined();

      // An organization that was never backfilled is rejected by PostgreSQL.
      await expectPostgresError(
        runner().query(
          `INSERT INTO "delivery_orders" ("id", "organization_id") VALUES ($1, $2)`,
          [randomUUID(), randomUUID()],
        ),
        '23503',
      );

      const tables = (await runner().query(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_name IN ('organizations', 'users', 'refresh_tokens', 'delivery_orders')
          ORDER BY table_name`,
      )) as Array<{ table_name: string }>;
      expect(tables.map((row) => row.table_name)).toEqual([
        'delivery_orders',
        'organizations',
        'refresh_tokens',
        'users',
      ]);
    });

    it('reverts the migration without leaving identity tables or the FK behind', async () => {
      await new IdentityAndAccess1793145600000().down(runner());

      const tables = (await runner().query(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_name IN ('organizations', 'users', 'refresh_tokens')`,
      )) as Array<{ table_name: string }>;
      expect(tables).toEqual([]);

      // With the FK gone, an arbitrary organization id is accepted again, which
      // proves the constraint was removed rather than only the table.
      await expect(
        runner().query(
          `INSERT INTO "delivery_orders" ("id", "organization_id") VALUES ($1, $2)`,
          [randomUUID(), randomUUID()],
        ),
      ).resolves.toBeDefined();
    });
  },
);
