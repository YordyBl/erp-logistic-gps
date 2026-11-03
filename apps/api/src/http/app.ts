import express, { type Express } from 'express';
import type { Logger } from 'pino';

import type { LoginRateLimitConfig } from '../config/config.js';
import type { TokenService } from '../modules/identity-and-access/application/ports/TokenService.js';
import type { UserRepository } from '../modules/identity-and-access/application/ports/UserRepository.js';
import type { CreateUserUseCase } from '../modules/identity-and-access/application/use-cases/create-user/CreateUserUseCase.js';
import type { LoginUseCase } from '../modules/identity-and-access/application/use-cases/login/LoginUseCase.js';
import type { LogoutUseCase } from '../modules/identity-and-access/application/use-cases/logout/LogoutUseCase.js';
import type { RefreshSessionUseCase } from '../modules/identity-and-access/application/use-cases/refresh-session/RefreshSessionUseCase.js';
import type { RefreshCookieConfig } from './cookies.js';
import { createAuthenticate } from './middleware/authenticate.js';
import { createErrorHandler } from './middleware/error-handler.js';
import { InMemoryLoginRateLimiter } from './middleware/login-rate-limit.js';
import { notFoundHandler } from './middleware/not-found.js';
import { createRequestLogger } from './middleware/request-logger.js';
import { getAuthenticatedUser, getOrganizationId } from './request-context.js';
import { classifyTrackingMutation } from './tracking-mutation.js';
import { createAuthRouter } from './routes/auth.routes.js';
import {
  createCustomersRouter,
  type CustomersHttpPorts,
} from './routes/customers.routes.js';
import {
  createDeliveryOrdersRouter,
  type DeliveryOrdersHttpPorts,
} from './routes/delivery-orders.routes.js';
import { createDeliveryRoutesRouter } from './routes/delivery-routes.routes.js';
import { createDeliveryExecutionRouter } from './routes/delivery-execution.routes.js';
import type { DeliveryExecutionModule } from '../modules/delivery-execution/composition/composition-root.js';
import {
  createDriversRouter,
  type DriversHttpPorts,
} from './routes/drivers.routes.js';
import {
  createHealthRouter,
  type ReadinessCheck,
} from './routes/health.routes.js';
import { createUsersRouter } from './routes/users.routes.js';
import { createDispatchDashboardRouter, type DispatchDashboardQuery } from './routes/dispatch-dashboard.routes.js';
import type { TrackingWebSocketHub } from '../modules/delivery-tracking/infrastructure/TrackingWebSocketHub.js';
import {
  createVehiclesRouter,
  type VehiclesHttpPorts,
} from './routes/vehicles.routes.js';

/** Request bodies are small JSON documents; cap them before zod sees them. */
const JSON_BODY_LIMIT = '100kb';

/**
 * Authentication dependencies, already composed.
 *
 * The HTTP layer only adapts use cases and the token/user ports; session
 * creation, rotation, reuse detection and password hashing live in the
 * `identity-and-access` module. `registerOrganization` is deliberately absent:
 * organizations are provisioned by the seed/bootstrap path, never by a public
 * HTTP route (T1 review finding R1-002).
 */
export interface AuthHttpDependencies {
  readonly loginOrganizationId?: string;
  readonly login: LoginUseCase;
  readonly refreshSession: RefreshSessionUseCase;
  readonly logout: LogoutUseCase;
  readonly createUser: CreateUserUseCase;
  readonly users: UserRepository;
  readonly tokenService: TokenService;
  readonly cookie: RefreshCookieConfig;
  readonly loginRateLimit: LoginRateLimitConfig;
}

/**
 * Catalog use cases, already composed.
 *
 * The three catalogs are independent modules; they share only the HTTP
 * convention (JWT tenant context, role gate, typed validation errors) and never
 * import each other.
 */
export interface CatalogsHttpDependencies {
  readonly customers: CustomersHttpPorts;
  readonly drivers: DriversHttpPorts;
  readonly vehicles: VehiclesHttpPorts;
}

export interface AppDependencies {
  /** Use cases and repository of the delivery-orders module, already composed. */
  readonly deliveryOrders: DeliveryOrdersHttpPorts;
  /** Optional for old test callers; production always composes the route planner. */
  readonly deliveryRoutes?: import('../modules/delivery-routes/composition/composition-root.js').DeliveryRoutesModule;
  /** Production always composes private evidence storage; optional for legacy test callers. */
  readonly deliveryExecution?: DeliveryExecutionModule;
  /** Optional for HTTP-only test callers; production always binds the tracking socket hub. */
  readonly trackingHub?: Pick<TrackingWebSocketHub, 'issueTicket' | 'publish'>;
  /** Tenant-scoped dashboard read model; optional only for legacy HTTP test callers. */
  readonly dispatchDashboard?: DispatchDashboardQuery;
  /** Identity use cases and ports used by the auth and user routes. */
  readonly auth: AuthHttpDependencies;
  /** Customer, driver and vehicle catalogs. */
  readonly catalogs: CatalogsHttpDependencies;
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
 * Every protected route mounts the same JWT middleware, which replaces the
 * temporary `x-organization-id` header of Fase 0.
 */
export function buildApp({
  deliveryOrders,
  deliveryRoutes,
  deliveryExecution,
  trackingHub,
  dispatchDashboard,
  auth,
  catalogs,
  readiness,
  logger,
}: AppDependencies): Express {
  const app = express();
  const authenticate = createAuthenticate({
    tokenService: auth.tokenService,
    users: auth.users,
  });

  app.disable('x-powered-by');
  app.use(createRequestLogger(logger));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(createHealthRouter({ readiness, logger }));
  app.use((request, response, next) => {
    const mutation = classifyTrackingMutation(request.method, request.path);
    if (mutation !== null) {
      response.once('finish', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return;
        const organizationId = getOrganizationId(response);
        if (organizationId !== undefined) {
          void trackingHub?.publish(organizationId, mutation);
        }
      });
    }
    next();
  });
  app.post('/api/v1/tracking/ticket', authenticate, (request, response) => {
    const identity = getAuthenticatedUser(response);
    if (identity === undefined) {
      response.status(401).json({ error: { code: 'AUTH_SESSION_INVALID' } });
      return;
    }
    if (trackingHub === undefined) {
      response.status(503).json({ error: { code: 'TRACKING_UNAVAILABLE' } });
      return;
    }
    const issued = trackingHub.issueTicket({
      id: identity.id,
      organizationId: identity.organizationId,
      role: identity.role,
    }, request.header('origin'));
    response.status(201).set('Cache-Control', 'private, no-store').json({ data: issued });
  });
  app.use(
    '/api/v1/auth',
    createAuthRouter({
      login: auth.login,
      ...(auth.loginOrganizationId === undefined ? {} : { loginOrganizationId: auth.loginOrganizationId }),
      refreshSession: auth.refreshSession,
      logout: auth.logout,
      cookie: auth.cookie,
      loginRateLimiter: new InMemoryLoginRateLimiter(auth.loginRateLimit),
      authenticate,
    }),
  );
  app.use(
    '/api/v1/users',
    createUsersRouter({ createUser: auth.createUser }, authenticate),
  );
  if (dispatchDashboard !== undefined) {
    app.use('/api/v1/dashboard', createDispatchDashboardRouter(dispatchDashboard, authenticate));
  }
  // Delivery-execution has narrower per-route role gates (including DRIVER
  // evidence uploads). Mount it before the role-restricted order catalog so
  // those exact paths can be handled without broadening catalog access.
  if (deliveryExecution !== undefined) {
    app.use('/api/v1', createDeliveryExecutionRouter(deliveryExecution, authenticate));
  }
  app.use(
    '/api/v1/delivery-orders',
    createDeliveryOrdersRouter(
      deliveryOrders,
      authenticate,
      catalogs.customers.getCustomer,
      catalogs.customers.listCustomers,
    ),
  );
  if (deliveryRoutes !== undefined) {
    app.use('/api/v1/delivery-routes', createDeliveryRoutesRouter(deliveryRoutes, authenticate));
  }
  app.use(
    '/api/v1/customers',
    createCustomersRouter(catalogs.customers, authenticate),
  );
  app.use('/api/v1/drivers', createDriversRouter(catalogs.drivers, authenticate));
  app.use(
    '/api/v1/vehicles',
    createVehiclesRouter(catalogs.vehicles, authenticate),
  );
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
