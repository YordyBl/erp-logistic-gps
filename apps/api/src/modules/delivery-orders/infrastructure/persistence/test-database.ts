import { Client } from 'pg';

/**
 * Availability probe for PostgreSQL-backed integration tests.
 *
 * Integration tests must pass on machines without Docker. They are skipped
 * with a logged reason when `DATABASE_URL` is absent or the server cannot be
 * reached; a reachable server without the migrated schema still fails, because
 * a missing migration is a real defect rather than an environment limitation.
 */
export type IntegrationDatabaseProbe =
  | { readonly available: true; readonly url: string }
  | { readonly available: false; readonly reason: string };

const CONNECTION_TIMEOUT_MS = 2000;

export async function probeIntegrationDatabase(): Promise<IntegrationDatabaseProbe> {
  const url = process.env.DATABASE_URL?.trim();

  if (url === undefined || url.length === 0) {
    return {
      available: false,
      reason: 'DATABASE_URL is not set',
    };
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
      // The probe only needs the connection outcome; closing errors are noise.
    });
  }
}
