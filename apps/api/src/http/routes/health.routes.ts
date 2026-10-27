import { Router } from 'express';
import type { Logger } from 'pino';

import { getCorrelationId } from '../request-context.js';

/**
 * Liveness and readiness endpoints.
 *
 * `/healthz` is liveness: it answers as long as the process can serve HTTP, and
 * the container healthcheck uses it. `/readyz` is readiness: it asks the
 * injected probe (a database `SELECT 1` in production) and reports 503 while the
 * dependency is unavailable. Neither endpoint requires tenant context.
 */
export type ReadinessCheck = () => Promise<void>;

export interface HealthRouterOptions {
  readonly readiness: ReadinessCheck;
  readonly logger: Logger;
}

export function createHealthRouter({
  readiness,
  logger,
}: HealthRouterOptions): Router {
  const router = Router();

  router.get('/healthz', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  router.get('/readyz', async (_request, response) => {
    try {
      await readiness();
      response.status(200).json({
        status: 'ready',
        checks: { database: 'up' },
      });
    } catch (error) {
      logger.warn(
        {
          err: error,
          correlationId: getCorrelationId(response),
        },
        'readiness probe failed',
      );

      // The dependency's error message can contain credentials or connection
      // details, so it stays in the log and never reaches the response.
      response.status(503).json({
        status: 'not_ready',
        checks: { database: 'down' },
      });
    }
  });

  return router;
}
