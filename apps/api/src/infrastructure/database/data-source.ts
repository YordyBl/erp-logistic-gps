import 'reflect-metadata';

import { join } from 'node:path';

import { DataSource, type DataSourceOptions } from 'typeorm';

import { DeliveryOrderEntity } from '../../modules/delivery-orders/infrastructure/persistence/entities/DeliveryOrderEntity.js';
import { DeliveryOrderPackageEntity } from '../../modules/delivery-orders/infrastructure/persistence/entities/DeliveryOrderPackageEntity.js';

/**
 * Process-wide TypeORM data source.
 *
 * Configuration is environment-driven: `DATABASE_URL` wins when present
 * (Docker Compose derives it from the `POSTGRES_*` values); otherwise the
 * discrete `POSTGRES_*` variables are used with the throwaway local defaults
 * from `.env.example`.
 *
 * `synchronize` stays false in every environment: the schema evolves only
 * through reviewed migrations, and the compose `migrations` job runs them as a
 * separate process (ADR-002 §3).
 *
 * Every session is pinned to America/Lima. `timestamptz` stores absolute
 * instants; the session timezone only controls how PostgreSQL renders them, so
 * presenting Lima time never shifts the stored value (plan §2).
 */

const MIGRATIONS_GLOB = join(import.meta.dirname, '../../../migrations/*.ts');

const LOCAL_DEFAULTS = {
  host: 'localhost',
  port: 5432,
  username: 'erp_logistic',
  password: 'change-me-local-only',
  database: 'erp_logistic',
} as const;

export interface DataSourceFactoryOptions {
  /** Explicit connection string, used by tests; falls back to the environment. */
  readonly url?: string;
}

export function createDataSource(options: DataSourceFactoryOptions = {}): DataSource {
  const url = options.url ?? readOptionalEnv('DATABASE_URL');

  return new DataSource(
    url === undefined
      ? { ...commonOptions(), ...discreteConnectionOptions() }
      : { ...commonOptions(), url },
  );
}

function commonOptions() {
  return {
    type: 'postgres' as const,
    entities: [DeliveryOrderEntity, DeliveryOrderPackageEntity],
    migrations: [MIGRATIONS_GLOB],
    migrationsTableName: 'migrations',
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: {
      // Pin every connection to the ratified timezone even when the server
      // configuration differs; compose already sets it at the server level.
      options: '-c timezone=America/Lima',
    },
  } satisfies Partial<DataSourceOptions>;
}

function discreteConnectionOptions() {
  return {
    host: readOptionalEnv('POSTGRES_HOST') ?? LOCAL_DEFAULTS.host,
    port: readPort(),
    username: readOptionalEnv('POSTGRES_USER') ?? LOCAL_DEFAULTS.username,
    password: readOptionalEnv('POSTGRES_PASSWORD') ?? LOCAL_DEFAULTS.password,
    database: readOptionalEnv('POSTGRES_DB') ?? LOCAL_DEFAULTS.database,
  };
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function readPort(): number {
  const raw = readOptionalEnv('POSTGRES_PORT');
  if (raw === undefined) {
    return LOCAL_DEFAULTS.port;
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`POSTGRES_PORT must be a valid TCP port, received "${raw}"`);
  }

  return port;
}

/**
 * Shared instance for the CLI and the future process composition root.
 *
 * The CLI requires exactly one DataSource export in this file, so this is the
 * only export of an instance; other modules import it as the default export.
 */
const appDataSource = createDataSource();

export default appDataSource;
