import type { Express } from 'express';
import { pino, type Logger } from 'pino';

import type { DeliveryOrderRepository } from '../../../modules/delivery-orders/application/ports/DeliveryOrderRepository.js';
import {
  createDeliveryOrdersModule,
  InMemoryEventPublisher,
  type DeliveryOrdersModule,
} from '../../../modules/delivery-orders/composition/composition-root.js';
import {
  FixedClock,
  SequentialIdGenerator,
} from '../../../modules/delivery-orders/tests/support/test-doubles.js';
import { buildApp } from '../../app.js';
import type { ReadinessCheck } from '../../routes/health.routes.js';

export const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
export const ORGANIZATION_HEADER = 'x-organization-id';
export const CREATED_AT = '2026-10-26T15:00:00.000Z';
export const FIRST_ORDER_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Valid create payload with the same shape the application command schema
 * accepts. Values are deliberately not pre-normalized (lowercase public code and
 * package codes) so the tests observe the documented normalization.
 */
export function validOrderBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    publicCode: 'ord-2026-0001',
    recipient: { name: 'Ana Torres', phone: '+51 987 654 321' },
    deliveryAddress: {
      addressLine: 'Av. Javier Prado Este 1234',
      district: 'San Borja',
      latitude: -12.0975,
      longitude: -77.0023,
    },
    packages: [
      { code: 'pkg-001', description: 'Sealed box', weightKg: 2.5 },
      { code: 'pkg-002', description: 'Document envelope' },
    ],
    ...overrides,
  };
}

export interface TestAppOptions {
  readonly repository?: DeliveryOrderRepository;
  readonly readiness?: ReadinessCheck;
  readonly logger?: Logger;
}

export interface TestApp {
  readonly app: Express;
  readonly logger: Logger;
  readonly module: DeliveryOrdersModule;
}

/**
 * Builds the real Express app with in-memory adapters and deterministic time
 * and ids. No database or network is involved.
 */
export function buildTestApp(options: TestAppOptions = {}): TestApp {
  const logger = options.logger ?? pino({ level: 'silent' });
  const module = createDeliveryOrdersModule({
    clock: new FixedClock(CREATED_AT),
    idGenerator: new SequentialIdGenerator(),
    eventPublisher: new InMemoryEventPublisher(),
    ...(options.repository === undefined ? {} : { repository: options.repository }),
  });

  const app = buildApp({
    deliveryOrders: module,
    readiness: options.readiness ?? (async () => undefined),
    logger,
  });

  return { app, logger, module };
}

/**
 * Repository whose every operation fails, used to prove that an unexpected
 * adapter failure becomes a generic 500 instead of leaking internals.
 */
export function createFailingRepository(
  message = 'database connection lost',
): DeliveryOrderRepository {
  const fail = async (): Promise<never> => {
    throw new Error(message);
  };

  return {
    save: fail,
    findById: fail,
    findByPublicCode: fail,
  };
}
