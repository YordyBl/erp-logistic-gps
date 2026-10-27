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
import { createAuthRouter } from './routes/auth.routes.js';
import {
  createDeliveryOrdersRouter,
  type DeliveryOrdersHttpPorts,
} from './routes/delivery-orders.routes.js';
import {
  createHealthRouter,
  type ReadinessCheck,
} from './routes/health.routes.js';
import { createUsersRouter } from './routes/users.routes.js';

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
  readonly login: LoginUseCase;
  readonly refreshSession: RefreshSessionUseCase;
  readonly logout: LogoutUseCase;
  readonly createUser: CreateUserUseCase;
  readonly users: UserRepository;
  readonly tokenService: TokenService;
  readonly cookie: RefreshCookieConfig;
  readonly loginRateLimit: LoginRateLimitConfig;
}

export interface AppDependencies {
  /** Use cases and repository of the delivery-orders module, already composed. */
  readonly deliveryOrders: DeliveryOrdersHttpPorts;
  /** Identity use cases and ports used by the auth and user routes. */
  readonly auth: AuthHttpDependencies;
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
  auth,
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
  app.use(
    '/api/v1/auth',
    createAuthRouter({
      login: auth.login,
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
  app.use(
    '/api/v1/delivery-orders',
    createDeliveryOrdersRouter(deliveryOrders, authenticate),
  );
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
