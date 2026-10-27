import { randomUUID } from 'node:crypto';

import type { Response } from 'express';
import type { Logger } from 'pino';
import { pinoHttp, type HttpLogger } from 'pino-http';

import { setCorrelationId } from '../request-context.js';

/**
 * Correlation-id header.
 *
 * An incoming value is honored so a gateway or client can correlate its own
 * trace with the API logs; otherwise the API generates one. The value is always
 * echoed in the response.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Bounded, log-safe request id shape. Arbitrary client strings are rejected
 * instead of being copied into logs and response headers.
 */
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function createRequestLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    genReqId: (request, response) => {
      const requestId =
        readIncomingRequestId(request.headers[REQUEST_ID_HEADER]) ?? randomUUID();

      // pino-http types the second argument as the raw ServerResponse; at
      // runtime Express passes its Response, which owns `locals` and setHeader.
      const expressResponse = response as Response;
      setCorrelationId(expressResponse, requestId);
      response.setHeader(REQUEST_ID_HEADER, requestId);

      return requestId;
    },
  });
}

function readIncomingRequestId(
  header: string | string[] | undefined,
): string | undefined {
  if (typeof header !== 'string') {
    return undefined;
  }

  const candidate = header.trim();
  return SAFE_REQUEST_ID_PATTERN.test(candidate) ? candidate : undefined;
}
