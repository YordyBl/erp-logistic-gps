import 'reflect-metadata';

import { createServer } from 'node:http';

import { applyRuntimeTimezone, loadConfig } from './config/config.js';
import { buildApp } from './http/app.js';
import { createLogger } from './http/logger.js';
import { createDataSource } from './infrastructure/database/data-source.js';
import { createDeliveryOrdersModuleFromDataSource } from './modules/delivery-orders/composition/composition-root.js';

/**
 * API composition root and process entry point.
 *
 * The HTTP server starts before the database is reachable: `/healthz` must
 * answer as soon as the process is alive, and `/readyz` reports readiness
 * (503 + retry) until the TypeORM connection succeeds. Liveness must not depend
 * on a dependency that can restart independently.
 */

const config = loadConfig();
applyRuntimeTimezone(config);

const logger = createLogger(config.logLevel);

const dataSource = createDataSource(
  config.databaseUrl === undefined ? {} : { url: config.databaseUrl },
);

// Single-flight lazy initialization: concurrent readiness probes share one
// attempt, and a failed attempt is cleared so the next probe retries instead of
// leaving the API permanently unready after a transient database restart.
let initialization: Promise<void> | undefined;

function ensureDatabaseInitialized(): Promise<void> {
  if (dataSource.isInitialized) {
    return Promise.resolve();
  }

  if (initialization === undefined) {
    initialization = dataSource
      .initialize()
      .then(() => {
        logger.info('database connection initialized');
      })
      .catch((error: unknown) => {
        initialization = undefined;
        throw error;
      });
  }

  return initialization;
}

async function readiness(): Promise<void> {
  await ensureDatabaseInitialized();
  await dataSource.query('SELECT 1');
}

const deliveryOrders = await createDeliveryOrdersModuleFromDataSource(dataSource);
const app = buildApp({ deliveryOrders, readiness, logger });
const server = createServer(app);

server.listen(config.port, '0.0.0.0', () => {
  logger.info(
    {
      port: config.port,
      environment: config.environment,
      timezone: config.timezone,
    },
    'api listening',
  );

  void readiness().catch((error: unknown) => {
    logger.error(
      { err: error },
      'initial database connection failed; /readyz will report 503 and retry on demand',
    );
  });
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, 'api shutting down');

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });

  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal)
      .then(() => {
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'graceful shutdown failed');
        process.exit(1);
      });
  });
}
