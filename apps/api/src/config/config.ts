/**
 * Process configuration.
 *
 * Everything the API needs from the environment is read and validated once at
 * boot, so a typo fails fast instead of surfacing as a confusing runtime error.
 * No secret has a default value in code; the only defaults are throwaway local
 * development values that Compose also uses.
 */

/** Ratified system-wide timezone (architecture plan §2). Lima has no DST. */
export const LIMA_TIME_ZONE = 'America/Lima' as const;

export type AppEnvironment = 'development' | 'test' | 'production';

const ENVIRONMENTS = ['development', 'test', 'production'] as const;

const LOG_LEVELS = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const DEFAULT_PORT = 3000;

export interface AppConfig {
  readonly environment: AppEnvironment;
  readonly port: number;
  /**
   * Explicit connection string. When absent, the data source falls back to the
   * discrete `POSTGRES_*` variables used by Compose.
   */
  readonly databaseUrl: string | undefined;
  readonly timezone: typeof LIMA_TIME_ZONE;
  readonly logLevel: LogLevel;
}

/**
 * Reads configuration from `env`.
 *
 * `PORT` wins over `API_PORT`: the Compose stack exports `API_PORT=3000`, while
 * a bare `node`/`tsx` run follows the conventional `PORT`. Both resolve to the
 * same default so neither setup can drift silently.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    environment: readEnvironment(env),
    port: readPort(env),
    databaseUrl: readOptional(env.DATABASE_URL),
    timezone: LIMA_TIME_ZONE,
    logLevel: readLogLevel(env),
  };
}

/**
 * Pins the process timezone to America/Lima.
 *
 * This covers `Date` formatting in libraries that read `TZ` (logs use an
 * explicit formatter as well) and keeps local development aligned with the
 * database session timezone. A conflicting `TZ` value is overridden on purpose:
 * the timezone is a ratified decision, not an environment preference.
 */
export function applyRuntimeTimezone(config: AppConfig): void {
  process.env.TZ = config.timezone;
}

function readEnvironment(env: NodeJS.ProcessEnv): AppEnvironment {
  const value = readOptional(env.NODE_ENV) ?? 'development';

  if (!isEnvironment(value)) {
    throw new Error(
      `NODE_ENV must be one of ${ENVIRONMENTS.join(', ')}, received "${value}"`,
    );
  }

  return value;
}

function readPort(env: NodeJS.ProcessEnv): number {
  const explicitPort = readOptional(env.PORT);
  if (explicitPort !== undefined) {
    return parsePort(explicitPort, 'PORT');
  }

  const composePort = readOptional(env.API_PORT);
  if (composePort !== undefined) {
    return parsePort(composePort, 'API_PORT');
  }

  return DEFAULT_PORT;
}

function parsePort(raw: string, variable: string): number {
  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `${variable} must be an integer between 1 and 65535, received "${raw}"`,
    );
  }

  return port;
}

function readLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = readOptional(env.LOG_LEVEL);
  if (raw === undefined) {
    return 'info';
  }

  const level = raw.toLowerCase();
  if (!isLogLevel(level)) {
    throw new Error(
      `LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, received "${raw}"`,
    );
  }

  return level;
}

function readOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function isEnvironment(value: string): value is AppEnvironment {
  return (ENVIRONMENTS as readonly string[]).includes(value);
}

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}
