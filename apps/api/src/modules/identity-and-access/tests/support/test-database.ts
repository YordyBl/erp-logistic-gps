import { Client } from 'pg';

/**
 * Availability probe for the PostgreSQL-backed identity integration tests.
 *
 * These tests skip with a logged reason when `DATABASE_URL` is absent or the
 * server is unreachable. A reachable server without the migrated schema is a
 * different case: a missing migration is a defect, not an environment
 * limitation, so the probe throws and the suite fails loudly instead of
 * silently skipping (T1 review finding R3-integration-schema-dependency).
 */
export type IntegrationDatabaseProbe =
  | { readonly available: true; readonly url: string }
  | { readonly available: false; readonly reason: string };

const CONNECTION_TIMEOUT_MS = 2000;

interface SchemaRow {
  readonly organizations: string | null;
  readonly users: string | null;
  readonly refresh_tokens: string | null;
}

export async function probeIdentityDatabase(): Promise<IntegrationDatabaseProbe> {
  const url = process.env.DATABASE_URL?.trim();

  if (url === undefined || url.length === 0) {
    return { available: false, reason: 'DATABASE_URL is not set' };
  }

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });

  let missingSchemaMessage: string | undefined;

  try {
    await client.connect();
    await client.query('SELECT 1');

    // `to_regclass` returns NULL instead of throwing for a missing table, so
    // the probe can report every absent migration-2 table at once.
    const result = await client.query<SchemaRow>(
      `SELECT
         to_regclass('public.organizations')::text AS organizations,
         to_regclass('public.users')::text AS users,
         to_regclass('public.refresh_tokens')::text AS refresh_tokens`,
    );
    const row = result.rows[0];
    const missing = [
      ...(row?.organizations == null ? ['organizations'] : []),
      ...(row?.users == null ? ['users'] : []),
      ...(row?.refresh_tokens == null ? ['refresh_tokens'] : []),
    ];

    if (missing.length > 0) {
      missingSchemaMessage =
        'DATABASE_URL points to a reachable database without the migrated identity ' +
        `schema (missing: ${missing.join(', ')}). Run "npm run migration:run -w apps/api"; ` +
        'a missing migration is a defect, not a skipped environment.';
    }
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.end().catch(() => {
      // Only the probe outcome matters; closing errors are noise.
    });
  }

  if (missingSchemaMessage !== undefined) {
    throw new Error(missingSchemaMessage);
  }

  return { available: true, url };
}
