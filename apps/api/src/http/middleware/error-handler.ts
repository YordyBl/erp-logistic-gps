import { randomUUID } from 'node:crypto';

import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';

import {
  DeliveryOrderForbiddenError,
  DeliveryOrderInvariantError,
  DeliveryOrderNotFoundError,
  DeliveryOrderValidationError,
} from '../../modules/delivery-orders/domain/errors/DeliveryOrderError.js';
import type { ErrorDetails } from '../../shared/errors/DomainError.js';
import { HttpError, toErrorBody } from '../errors.js';
import { getCorrelationId } from '../request-context.js';

/**
 * Translates typed errors into HTTP responses.
 *
 * Mapping decisions (ADR-001 rule 9, `delivery-orders` DO-010):
 * - validation -> 400, field-level issues in `details`
 * - not found -> 404
 * - forbidden -> 404 with the not-found envelope, so cross-organization probes
 *   cannot confirm that an order exists; the real reason is logged at warn level
 * - invariant/conflict -> 409
 * - anything else -> 500 with a generic message and an error log
 */

interface MappedError {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly details: ErrorDetails | undefined;
  readonly logLevel: 'warn' | 'error' | undefined;
  readonly logMessage: string | undefined;
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const correlationId = getCorrelationId(response) ?? randomUUID();
    const mapped = mapError(error);

    if (mapped.logLevel === 'error') {
      logger.error(
        { err: error, code: mapped.code, correlationId },
        mapped.logMessage ?? 'unexpected error',
      );
    } else if (mapped.logLevel === 'warn') {
      logger.warn(
        { err: error, code: mapped.code, correlationId },
        mapped.logMessage ?? 'request rejected',
      );
    }

    response.status(mapped.statusCode).json(toErrorBody(mapped, correlationId));
  };
}

function mapError(error: unknown): MappedError {
  if (error instanceof HttpError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
      logLevel: undefined,
      logMessage: undefined,
    };
  }

  if (error instanceof DeliveryOrderValidationError) {
    return {
      statusCode: 400,
      code: error.code,
      message: error.message,
      details: error.details,
      logLevel: undefined,
      logMessage: undefined,
    };
  }

  if (error instanceof DeliveryOrderNotFoundError) {
    return {
      statusCode: 404,
      code: error.code,
      message: error.message,
      details: undefined,
      logLevel: undefined,
      logMessage: undefined,
    };
  }

  if (error instanceof DeliveryOrderForbiddenError) {
    // Enumeration safety: the response must be indistinguishable from an
    // unknown id. The application error remains visible in the log only.
    return {
      statusCode: 404,
      code: 'DELIVERY_ORDER_NOT_FOUND',
      message: `Delivery order ${error.orderId} was not found`,
      details: undefined,
      logLevel: 'warn',
      logMessage: 'cross-organization delivery order access denied',
    };
  }

  if (error instanceof DeliveryOrderInvariantError) {
    return {
      statusCode: 409,
      code: error.code,
      message: error.message,
      details: error.details,
      logLevel: undefined,
      logMessage: undefined,
    };
  }

  const bodyParserErrorType = readBodyParserErrorType(error);

  if (bodyParserErrorType === 'entity.parse.failed') {
    return {
      statusCode: 400,
      code: 'INVALID_JSON',
      message: 'Request body is not valid JSON',
      details: undefined,
      logLevel: 'warn',
      logMessage: 'request body could not be parsed',
    };
  }

  if (bodyParserErrorType === 'entity.too.large') {
    return {
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request body exceeds the allowed size',
      details: undefined,
      logLevel: 'warn',
      logMessage: 'request body exceeded the allowed size',
    };
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred while processing the request',
    details: undefined,
    logLevel: 'error',
    logMessage: 'unexpected error while handling request',
  };
}

interface BodyParserError {
  readonly type?: unknown;
}

function readBodyParserErrorType(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const type = (error as BodyParserError).type;
  return typeof type === 'string' ? type : undefined;
}
