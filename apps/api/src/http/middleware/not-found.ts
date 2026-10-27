import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

import { toErrorBody } from '../errors.js';
import { getCorrelationId } from '../request-context.js';

/**
 * Terminal handler for unmatched routes.
 *
 * Returning the same envelope as every other failure keeps client error
 * handling uniform, including the correlation id.
 */
export const notFoundHandler: RequestHandler = (_request, response) => {
  const correlationId = getCorrelationId(response) ?? randomUUID();

  response.status(404).json(
    toErrorBody(
      {
        code: 'ROUTE_NOT_FOUND',
        message: 'The requested route does not exist',
        details: undefined,
      },
      correlationId,
    ),
  );
};
