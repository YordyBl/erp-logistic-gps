interface PostgresDriverError {
  readonly code?: string;
  readonly constraint?: string;
}

interface DriverErrorCarrier {
  readonly driverError?: unknown;
}

/**
 * Reads the `pg` driver error wrapped by TypeORM's `QueryFailedError`.
 *
 * The constraint name is the stable contract: PostgreSQL error codes are too
 * coarse to distinguish one unique index from another.
 */
export function readPostgresDriverError(
  error: unknown,
): PostgresDriverError | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const driverError = (error as DriverErrorCarrier).driverError;

  if (typeof driverError !== 'object' || driverError === null) {
    return undefined;
  }

  return driverError as PostgresDriverError;
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
