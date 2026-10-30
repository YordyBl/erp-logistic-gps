import type { DataSource } from 'typeorm';

import type { AuthConfig } from '../../config/config.js';
import type { AppDependencies } from '../../http/app.js';
import type { S3EvidenceObjectStorageConfig } from '../../modules/delivery-execution/infrastructure/S3EvidenceObjectStorage.js';
import { S3EvidenceObjectStorage } from '../../modules/delivery-execution/infrastructure/S3EvidenceObjectStorage.js';
import {
  createDeliveryExecutionModuleFromDataSource,
  type DeliveryExecutionModule,
} from '../../modules/delivery-execution/composition/composition-root.js';
import {
  createCustomersModuleFromDataSource,
  type CustomersModule,
} from '../../modules/customers/composition/composition-root.js';
import {
  createDeliveryOrdersModuleFromDataSource,
  type DeliveryOrdersModule,
} from '../../modules/delivery-orders/composition/composition-root.js';
import { createDeliveryRoutesModule } from '../../modules/delivery-routes/composition/composition-root.js';
import { RoutePlanningTypeOrmStore } from '../dispatch/RoutePlanningTypeOrmStore.js';
import { DriverRouteTypeOrmStore } from '../dispatch/DriverRouteTypeOrmStore.js';
import {
  createDriversModuleFromDataSource,
  type DriversModule,
} from '../../modules/drivers/composition/composition-root.js';
import {
  createIdentityModuleFromDataSource,
  type IdentityModule,
} from '../../modules/identity-and-access/composition/composition-root.js';
import {
  createVehiclesModuleFromDataSource,
  type VehiclesModule,
} from '../../modules/vehicles/composition/composition-root.js';

export interface ComposedApiModules {
  readonly deliveryOrders: DeliveryOrdersModule;
  readonly deliveryRoutes: ReturnType<typeof createDeliveryRoutesModule>;
  readonly deliveryExecution?: DeliveryExecutionModule;
  readonly identity: IdentityModule;
  readonly customers: CustomersModule;
  readonly drivers: DriversModule;
  readonly vehicles: VehiclesModule;
  readonly dependencies: Pick<
    AppDependencies,
    'deliveryOrders' | 'deliveryRoutes' | 'deliveryExecution' | 'auth' | 'catalogs'
  >;
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
  evidenceStorageConfig?: S3EvidenceObjectStorageConfig,
): Promise<ComposedApiModules> {
  const [deliveryOrders, identity, customers, drivers, vehicles] =
    await Promise.all([
      createDeliveryOrdersModuleFromDataSource(dataSource),
      createIdentityModuleFromDataSource(dataSource, authConfig),
      createCustomersModuleFromDataSource(dataSource),
      createDriversModuleFromDataSource(dataSource),
      createVehiclesModuleFromDataSource(dataSource),
    ]);
  const deliveryExecution = evidenceStorageConfig === undefined
    ? undefined
    : await createDeliveryExecutionModuleFromDataSource(
      dataSource,
      new S3EvidenceObjectStorage(evidenceStorageConfig),
    );
  const deliveryRoutes = createDeliveryRoutesModule({
    store: new RoutePlanningTypeOrmStore(dataSource),
    executionStore: new DriverRouteTypeOrmStore(dataSource),
    getDriver: drivers.getDriver, getVehicle: vehicles.getVehicle,
  });

  const dependencies: Pick<
    AppDependencies,
    'deliveryOrders' | 'deliveryRoutes' | 'deliveryExecution' | 'auth' | 'catalogs'
  > = {
    deliveryOrders,
    deliveryRoutes,
    ...(deliveryExecution === undefined ? {} : { deliveryExecution }),
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
    catalogs: { customers, drivers, vehicles },
  };

  return {
    deliveryOrders, deliveryRoutes,
    ...(deliveryExecution === undefined ? {} : { deliveryExecution }),
    identity, customers, drivers, vehicles, dependencies,
  };
}
