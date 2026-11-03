/**
 * Process configuration.
 *
 * Everything the API needs from the environment is read and validated once at
 * boot, so a typo fails fast instead of surfacing as a confusing runtime error.
 * No secret has a default value in code; the only defaults are throwaway local
 * development values that Compose also uses.
 */

import { isUuid } from '../shared/ids.js';

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
const DEFAULT_GPS_SIMULATION_INTERVAL_SECONDS = 4;
const DEFAULT_GPS_SIMULATION_TIME_SCALE = 1;
const DEFAULT_GPS_POSITION_RETENTION_DAYS = 30;

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
  readonly gpsSimulationIntervalSeconds: number;
  readonly gpsSimulationTimeScale: number;
  readonly gpsPositionRetentionDays: number;
  readonly valhallaUrl: string | undefined;
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
    gpsSimulationIntervalSeconds: readBoundedInteger(
      env.GPS_SIMULATION_INTERVAL_SECONDS,
      'GPS_SIMULATION_INTERVAL_SECONDS',
      DEFAULT_GPS_SIMULATION_INTERVAL_SECONDS,
      3,
      5,
    ),
    gpsSimulationTimeScale: readBoundedInteger(
      env.GPS_SIMULATION_TIME_SCALE,
      'GPS_SIMULATION_TIME_SCALE',
      DEFAULT_GPS_SIMULATION_TIME_SCALE,
      1,
      100,
    ),
    gpsPositionRetentionDays: readPositiveInteger(
      env.GPS_POSITION_RETENTION_DAYS,
      'GPS_POSITION_RETENTION_DAYS',
      DEFAULT_GPS_POSITION_RETENTION_DAYS,
    ),
    valhallaUrl: readOptionalLocalServiceUrl(env.VALHALLA_URL, 'VALHALLA_URL'),
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

function readBoundedInteger(
  raw: string | undefined,
  variable: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = readOptional(raw);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${variable} must be an integer between ${minimum} and ${maximum}, received "${value}"`);
  }
  return parsed;
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

function readOptionalLocalServiceUrl(raw: string | undefined, variable: string): string | undefined {
  const value = readOptional(raw);
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variable} must be a local HTTP(S) URL`);
  }
  const host = url.hostname.toLowerCase();
  const localHost = host === 'localhost' || host.endsWith('.localhost') ||
    host === 'valhalla' || host === 'host.docker.internal' ||
    host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
  if (!['http:', 'https:'].includes(url.protocol) || !localHost ||
      url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error(`${variable} must be a local HTTP(S) URL without credentials or query parameters`);
  }
  return url.toString().replace(/\/$/, '');
}

function isEnvironment(value: string): value is AppEnvironment {
  return (ENVIRONMENTS as readonly string[]).includes(value);
}

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * Authentication configuration (ADR-003).
 *
 * Loaded separately from {@link loadConfig} so the process can boot without
 * authentication secrets until the HTTP auth layer consumes it. `JWT_SECRET`
 * has no default: a signing secret in code would be a security defect. The
 * remaining values have ratified defaults that a deployment may override.
 */
export const JWT_MIN_SECRET_LENGTH = 32;

export interface LoginRateLimitConfig {
  readonly maxAttempts: number;
  readonly windowSeconds: number;
}

export interface AuthConfig {
  readonly loginOrganizationId?: string;
  readonly jwtSecret: string;
  readonly jwtIssuer: string;
  readonly jwtAudience: string;
  readonly accessTokenTtlMinutes: number;
  readonly refreshTokenTtlDays: number;
  readonly cookieSecure: boolean;
  readonly loginRateLimit: LoginRateLimitConfig;
}

const DEFAULT_JWT_ISSUER = 'erp-logistic-api';
const DEFAULT_JWT_AUDIENCE = 'erp-logistic-web';
const DEFAULT_ACCESS_TOKEN_TTL_MINUTES = 15;
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 7;
const DEFAULT_LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 10;
const DEFAULT_LOGIN_RATE_LIMIT_WINDOW_SECONDS = 900;

/**
 * Reads and validates authentication configuration.
 *
 * `COOKIE_SECURE` defaults to `true`; local development over plain HTTP must opt
 * out explicitly and never ships that value to a deployed environment.
 * Rate-limit values are enforced by the HTTP login route; the in-memory limiter
 * is an MVP assumption (S9).
 */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const loginOrganizationId = readOptional(env.LOGIN_ORGANIZATION_ID);
  if (loginOrganizationId !== undefined && !isUuid(loginOrganizationId)) {
    throw new Error('LOGIN_ORGANIZATION_ID must be a UUID');
  }
  return {
    ...(loginOrganizationId === undefined ? {} : { loginOrganizationId }),
    jwtSecret: readJwtSecret(env),
    jwtIssuer: readOptional(env.JWT_ISSUER) ?? DEFAULT_JWT_ISSUER,
    jwtAudience: readOptional(env.JWT_AUDIENCE) ?? DEFAULT_JWT_AUDIENCE,
    accessTokenTtlMinutes: readPositiveInteger(
      env.ACCESS_TOKEN_TTL_MINUTES,
      'ACCESS_TOKEN_TTL_MINUTES',
      DEFAULT_ACCESS_TOKEN_TTL_MINUTES,
    ),
    refreshTokenTtlDays: readPositiveInteger(
      env.REFRESH_TOKEN_TTL_DAYS,
      'REFRESH_TOKEN_TTL_DAYS',
      DEFAULT_REFRESH_TOKEN_TTL_DAYS,
    ),
    cookieSecure: readBoolean(env.COOKIE_SECURE, 'COOKIE_SECURE', true),
    loginRateLimit: {
      maxAttempts: readPositiveInteger(
        env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
        'LOGIN_RATE_LIMIT_MAX_ATTEMPTS',
        DEFAULT_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
      ),
      windowSeconds: readPositiveInteger(
        env.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
        'LOGIN_RATE_LIMIT_WINDOW_SECONDS',
        DEFAULT_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
      ),
    },
  };
}

function readJwtSecret(env: NodeJS.ProcessEnv): string {
  const secret = readOptional(env.JWT_SECRET);

  if (secret === undefined) {
    throw new Error('JWT_SECRET must be set');
  }

  if (secret.length < JWT_MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${JWT_MIN_SECRET_LENGTH} characters`,
    );
  }

  return secret;
}

function readPositiveInteger(
  raw: string | undefined,
  variable: string,
  fallback: number,
): number {
  const value = readOptional(raw);

  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${variable} must be a positive integer, received "${value}"`);
  }

  return parsed;
}

function readBoolean(
  raw: string | undefined,
  variable: string,
  fallback: boolean,
): boolean {
  const value = readOptional(raw);

  if (value === undefined) {
    return fallback;
  }

  const normalized = value.toLowerCase();

  if (normalized !== 'true' && normalized !== 'false') {
    throw new Error(`${variable} must be "true" or "false", received "${value}"`);
  }

  return normalized === 'true';
}
