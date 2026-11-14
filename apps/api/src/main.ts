import 'reflect-metadata';

import { createServer } from 'node:http';

import { applyRuntimeTimezone, loadAuthConfig, loadConfig } from './config/config.js';
import { loadEvidenceStorageConfig } from './config/evidence-storage-config.js';
import { buildApp } from './http/app.js';
import { createLogger } from './http/logger.js';
import { createDataSource } from './infrastructure/database/data-source.js';
import { composeApiModules } from './infrastructure/composition/composition-root.js';
import { SystemClock } from './shared/clock.js';
import { RoutePositionSimulator } from './modules/delivery-tracking/application/RoutePositionSimulator.js';
import { SimulatedPositionProvider } from './modules/delivery-tracking/application/SimulatedPositionProvider.js';
import { RoutePositionTypeOrmStore } from './modules/delivery-tracking/infrastructure/RoutePositionTypeOrmStore.js';
import { ValhallaRouteGeometryProvider } from './modules/delivery-tracking/infrastructure/ValhallaRouteGeometryProvider.js';
import { WebSocketTicketStore } from './modules/delivery-tracking/infrastructure/WebSocketTicketStore.js';
import { TrackingWebSocketHub } from './modules/delivery-tracking/infrastructure/TrackingWebSocketHub.js';
import { DeliveryRouteNotFoundError } from './modules/delivery-routes/domain/errors/DeliveryRouteError.js';
import type { RoutePosition, RoutePositionContext } from './modules/delivery-tracking/application/ports/PositionProvider.js';

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

// Authentication secrets are validated at boot: JWT_SECRET has no default and
// the process must not start without it.
const authConfig = loadAuthConfig();

const logger = createLogger(config.logLevel);

const dataSource = createDataSource(
  config.databaseUrl === undefined ? {} : { url: config.databaseUrl },
);
const clock = new SystemClock();
const positionStore = new RoutePositionTypeOrmStore(dataSource);
const trackingHubRef: { current?: TrackingWebSocketHub } = {};
const simulatedCompletionRef: { current?: (route: RoutePositionContext, position: RoutePosition) => Promise<void> } = {};
const geometryProvider = config.valhallaUrl === undefined
  ? { getGeometry: async () => null }
  : new ValhallaRouteGeometryProvider(config.valhallaUrl);
const positionSimulator = new RoutePositionSimulator(
  positionStore,
  new SimulatedPositionProvider(geometryProvider, clock, undefined, config.gpsSimulationTimeScale),
  clock,
  {
    intervalMilliseconds: config.gpsSimulationIntervalSeconds * 1_000,
    retentionDays: config.gpsPositionRetentionDays,
    samplingEnabled: config.routeSimulationEnabled,
  },
  (error) => logger.error({ err: error }, 'GPS position simulation tick failed'),
  async (position) => {
    await trackingHubRef.current?.publish(position.organizationId, 'position');
  },
  async (route, position) => {
    await simulatedCompletionRef.current?.(route, position);
  },
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
        positionSimulator.start();
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

const composed = await composeApiModules(
  dataSource,
  authConfig,
  loadEvidenceStorageConfig(),
  { routeSimulationEnabled: config.routeSimulationEnabled },
);
simulatedCompletionRef.current = async (route, position) => {
  if (route.driverUserId === undefined) return;
  await composed.deliveryRoutes.executeDriverRoute.completeSimulated({
    organizationId: route.organizationId,
    routeId: route.routeId,
    driverId: route.driverId,
    actorUserId: route.driverUserId,
    occurredAt: position.recordedAt,
  });
  await trackingHubRef.current?.publish(route.organizationId, 'route');
};
const { dependencies } = composed;
const trackingHubPort = {
  issueTicket(identity: { id: string; organizationId: string; role: 'ADMIN' | 'DISPATCHER' | 'DRIVER' },
    origin?: string) {
    if (trackingHubRef.current === undefined) throw new Error('Tracking socket hub is unavailable');
    return trackingHubRef.current.issueTicket(identity, origin);
  },
  publish(organizationId: string, kind: 'route' | 'order' | 'position') {
    return trackingHubRef.current?.publish(organizationId, kind) ?? Promise.resolve();
  },
};
const app = buildApp({ ...dependencies, trackingHub: trackingHubPort, readiness, logger });
const server = createServer(app);

const trackingHub = new TrackingWebSocketHub(server, {
  tickets: new WebSocketTicketStore(),
  resolveIdentity: async (ticketIdentity) => {
    const user = await composed.identity.users.findById(ticketIdentity.id);
    if (user === null || user.status !== 'active' ||
        user.organizationId !== ticketIdentity.organizationId) return null;
    return { id: user.id, organizationId: user.organizationId, role: user.role };
  },
  snapshot: async (identity) => {
    let routes;
    if (identity.role === 'DRIVER') {
      try {
        const result = await composed.deliveryRoutes.executeDriverRoute.mine({
          organizationId: identity.organizationId,
          actorUserId: identity.id,
        });
        routes = [result.route];
      } catch (error) {
        if (error instanceof DeliveryRouteNotFoundError) routes = [];
        else throw error;
      }
    } else {
      const result = await composed.deliveryRoutes.listRoutes.execute({
        organizationId: identity.organizationId,
      });
      routes = result.routes;
    }
    const activeRouteIds = routes
      .filter((route) => route.status === 'in_progress')
      .map((route) => route.id);
    const positions = await positionStore.findLatestForRoutes(identity.organizationId, activeRouteIds);
    return { routes, positions };
  },
});
trackingHubRef.current = trackingHub;
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

  await positionSimulator.stop();
  await trackingHub.close();

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
