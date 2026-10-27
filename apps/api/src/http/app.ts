import express, { type Express } from 'express';
import type { Logger } from 'pino';

import { createErrorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { createRequestLogger } from './middleware/request-logger.js';
import {
  createDeliveryOrdersRouter,
  type DeliveryOrdersHttpPorts,
} from './routes/delivery-orders.routes.js';
import {
  createHealthRouter,
  type ReadinessCheck,
} from './routes/health.routes.js';

/** Request bodies are small JSON documents; cap them before zod sees them. */
const JSON_BODY_LIMIT = '100kb';

export interface AppDependencies {
  /** Use cases and repository of the delivery-orders module, already composed. */
  readonly deliveryOrders: DeliveryOrdersHttpPorts;
  /** Readiness probe; rejects when a required dependency is unavailable. */
  readonly readiness: ReadinessCheck;
  readonly logger: Logger;
}

/**
 * Builds the Express application.
 *
 * Dependencies arrive composed, so HTTP tests inject in-memory adapters and the
 * process composition root injects TypeORM. Nothing here reads configuration or
 * opens connections, which keeps the app constructible in tests without a
 * database.
 *
 * Middleware order matters: request logging first so every response has a
 * correlation id, then body parsing, then routes, then the terminal handlers.
 */
export function buildApp({
  deliveryOrders,
  readiness,
  logger,
}: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(createRequestLogger(logger));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(createHealthRouter({ readiness, logger }));
  app.use('/api/v1/delivery-orders', createDeliveryOrdersRouter(deliveryOrders));
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
