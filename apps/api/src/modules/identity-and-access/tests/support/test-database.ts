import { Client } from 'pg';

/**
 * Availability probe for the PostgreSQL-backed identity integration tests.
 *
 * These tests skip with a logged reason when `DATABASE_URL` is absent or the
 * server is unreachable. A reachable server without the migrated schema still
 * fails: a missing migration is a defect, not an environment limitation.
 */
export type IntegrationDatabaseProbe =
  | { readonly available: true; readonly url: string }
  | { readonly available: false; readonly reason: string };

const CONNECTION_TIMEOUT_MS = 2000;

export async function probeIdentityDatabase(): Promise<IntegrationDatabaseProbe> {
  const url = process.env.DATABASE_URL?.trim();

  if (url === undefined || url.length === 0) {
    return { available: false, reason: 'DATABASE_URL is not set' };
  }

  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  });

  try {
    await client.connect();
    await client.query('SELECT 1');
    return { available: true, url };
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
}
