import type { ErrorDetails } from '../shared/errors/DomainError.js';

/**
 * Error raised by the HTTP layer itself, not by the domain or application.
 *
 * Domain errors keep their own typed classes; this one covers transport
 * concerns that have no application meaning, such as a missing request context
 * or an unknown route.
 */
export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: ErrorDetails | undefined;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: ErrorDetails,
  ) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface ApiErrorDescriptor {
  readonly code: string;
  readonly message: string;
  readonly details: ErrorDetails | undefined;
}

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: ErrorDetails;
    readonly correlationId: string;
  };
}

/**
 * Single error envelope for every non-2xx API response.
 *
 * `details` only appears when a handler supplies safe, structured context; raw
 * request bodies and internal error messages are never copied into it.
 */
export function toErrorBody(
  error: ApiErrorDescriptor,
  correlationId: string,
): ApiErrorBody {
  const base = {
    code: error.code,
    message: error.message,
    correlationId,
  };

  return {
    error: error.details === undefined ? base : { ...base, details: error.details },
  };
}
