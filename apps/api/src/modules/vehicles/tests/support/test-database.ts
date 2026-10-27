import { Client } from 'pg';

/**
 * Availability probe for the PostgreSQL-backed vehicle integration tests.
 *
 * The tests skip with a logged reason when `DATABASE_URL` is absent or the
 * server is unreachable. A reachable server without the migrated catalog schema
 * is a defect, not an environment limitation, so the probe throws instead of
 * silently skipping (same policy as the identity module).
 */
export type IntegrationDatabaseProbe =
  | { readonly available: true; readonly url: string }
  | { readonly available: false; readonly reason: string };

const CONNECTION_TIMEOUT_MS = 2000;

export async function probeVehiclesDatabase(): Promise<IntegrationDatabaseProbe> {
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

    const result = await client.query<{ vehicles: string | null }>(
      `SELECT to_regclass('public.vehicles')::text AS vehicles`,
    );

    if (result.rows[0]?.vehicles == null) {
      missingSchemaMessage =
        'DATABASE_URL points to a reachable database without the migrated vehicle ' +
        'catalog. Run "npm run migration:run -w apps/api"; a missing migration is a ' +
        'defect, not a skipped environment.';
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
