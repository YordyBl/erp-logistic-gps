import type { DataSource } from 'typeorm';

import type { AuthConfig } from '../../config/config.js';
import type { AppDependencies } from '../../http/app.js';
import {
  createDeliveryOrdersModuleFromDataSource,
  type DeliveryOrdersModule,
} from '../../modules/delivery-orders/composition/composition-root.js';
import {
  createIdentityModuleFromDataSource,
  type IdentityModule,
} from '../../modules/identity-and-access/composition/composition-root.js';

export interface ComposedApiModules {
  readonly deliveryOrders: DeliveryOrdersModule;
  readonly identity: IdentityModule;
  readonly dependencies: Pick<AppDependencies, 'deliveryOrders' | 'auth'>;
}

/**
 * Process composition root for the HTTP API.
 *
 * Every adapter is explicit: PostgreSQL repositories come from the data source
 * and the security adapters come from validated configuration. There is no
 * in-memory fallback — a wiring mistake makes the process fail at startup
 * instead of silently serving an instance that loses sessions on restart
 * (T1 review finding R1-composition-inmemory-fallback).
 *
 * The identity module is also returned so the process entry point can expose
 * its session policy and reuse adapters (for example a future seed script)
 * without constructing a second module.
 */
export async function composeApiModules(
  dataSource: DataSource,
  authConfig: AuthConfig,
): Promise<ComposedApiModules> {
  const [deliveryOrders, identity] = await Promise.all([
    createDeliveryOrdersModuleFromDataSource(dataSource),
    createIdentityModuleFromDataSource(dataSource, authConfig),
  ]);

  const dependencies: Pick<AppDependencies, 'deliveryOrders' | 'auth'> = {
    deliveryOrders,
    auth: {
      login: identity.login,
      refreshSession: identity.refreshSession,
      logout: identity.logout,
      createUser: identity.createUser,
      users: identity.users,
      tokenService: identity.tokenService,
      cookie: {
        secure: authConfig.cookieSecure,
        maxAgeSeconds: identity.sessionPolicy.refreshTokenTtlSeconds,
      },
      loginRateLimit: authConfig.loginRateLimit,
    },
  };

  return { deliveryOrders, identity, dependencies };
}
