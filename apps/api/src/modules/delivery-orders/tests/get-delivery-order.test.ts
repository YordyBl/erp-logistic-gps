import { describe, expect, it } from 'vitest';

import { createDeliveryOrdersModule, InMemoryEventPublisher } from '../composition/composition-root.js';
import {
  DeliveryOrderForbiddenError,
  DeliveryOrderNotFoundError,
  DeliveryOrderValidationError,
} from '../domain/errors/DeliveryOrderError.js';
import { FixedClock, SequentialIdGenerator } from './support/test-doubles.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_ORDER_ID = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = '2026-10-26T15:00:00.000Z';

const VALID_COMMAND = {
  organizationId: ORGANIZATION_ID,
  publicCode: 'ORD-2026-0042',
  recipient: { name: 'Luis Paredes', phone: '+51 999 111 222' },
  deliveryAddress: {
    addressLine: 'Calle Los Olivos 456',
    district: 'Miraflores',
    latitude: -12.1211,
    longitude: -77.0298,
  },
  packages: [{ code: 'PKG-100', description: 'Small parcel', weightKg: 1.25 }],
};

function buildModule(): ReturnType<typeof createDeliveryOrdersModule> {
  return createDeliveryOrdersModule({
    clock: new FixedClock(CREATED_AT),
    idGenerator: new SequentialIdGenerator(),
    eventPublisher: new InMemoryEventPublisher(),
  });
}

async function createOrder(module: ReturnType<typeof createDeliveryOrdersModule>) {
  const result = await module.createDeliveryOrder.execute(VALID_COMMAND);
  return result.order;
}

describe('GetDeliveryOrder', () => {
  it('returns an order to its owning organization', async () => {
    const module = buildModule();
    const created = await createOrder(module);

    const result = await module.getDeliveryOrder.execute({
      organizationId: ORGANIZATION_ID,
      orderId: created.id,
    });

    expect(result.order).toEqual(created);
    expect(result.order.deliveryAddress.latitude).toBe(-12.1211);
    expect(result.order.deliveryAddress.longitude).toBe(-77.0298);
  });

  it('rejects a read from another organization', async () => {
    const module = buildModule();
    const created = await createOrder(module);

    await expect(
      module.getDeliveryOrder.execute({
        organizationId: OTHER_ORGANIZATION_ID,
        orderId: created.id,
      }),
    ).rejects.toBeInstanceOf(DeliveryOrderForbiddenError);
  });

  it('reports a missing order as not found', async () => {
    const module = buildModule();

    await expect(
      module.getDeliveryOrder.execute({
        organizationId: ORGANIZATION_ID,
        orderId: MISSING_ORDER_ID,
      }),
    ).rejects.toBeInstanceOf(DeliveryOrderNotFoundError);
  });

  it('validates the query at the application boundary', async () => {
    const module = buildModule();

    await expect(
      module.getDeliveryOrder.execute({
        organizationId: 'not-a-uuid',
        orderId: MISSING_ORDER_ID,
      }),
    ).rejects.toBeInstanceOf(DeliveryOrderValidationError);
  });
});
