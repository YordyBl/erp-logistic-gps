import { describe, expect, it } from 'vitest';

import { createDeliveryOrdersModule, InMemoryEventPublisher } from '../composition/composition-root.js';
import {
  DeliveryOrderInvariantError,
  DeliveryOrderValidationError,
} from '../domain/errors/DeliveryOrderError.js';
import { DeliveryOrderCreated } from '../domain/events/DeliveryOrderCreated.js';
import { DeliveryAddress } from '../domain/value-objects/DeliveryAddress.js';
import { Recipient } from '../domain/value-objects/Recipient.js';
import { FixedClock, SequentialIdGenerator } from './support/test-doubles.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = '2026-10-26T15:00:00.000Z';

function validCommand(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organizationId: ORGANIZATION_ID,
    publicCode: 'ord-2026-0001',
    recipient: { name: 'Ana Torres', phone: '+51 987 654 321' },
    deliveryAddress: { addressLine: 'Av. Javier Prado Este 1234', district: 'San Borja' },
    packages: [
      { code: 'pkg-001', description: 'Sealed box', weightKg: 2.5 },
      { code: 'pkg-002', description: 'Document envelope' },
    ],
    ...overrides,
  };
}

function buildModule(): {
  eventPublisher: InMemoryEventPublisher;
  module: ReturnType<typeof createDeliveryOrdersModule>;
} {
  const eventPublisher = new InMemoryEventPublisher();
  const module = createDeliveryOrdersModule({
    clock: new FixedClock(CREATED_AT),
    idGenerator: new SequentialIdGenerator(),
    eventPublisher,
  });
  return { eventPublisher, module };
}

describe('CreateDeliveryOrder', () => {
  it('creates an order with a UUID id, readable public code and tenant scope', async () => {
    const { module } = buildModule();

    const result = await module.createDeliveryOrder.execute(validCommand());

    expect(result.order.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(result.order.publicCode).toBe('ORD-2026-0001');
    expect(result.order.organizationId).toBe(ORGANIZATION_ID);
    expect(result.order.status).toBe('created');
    expect(result.order.createdAt).toBe(CREATED_AT);
    expect(result.order.updatedAt).toBe(CREATED_AT);
    expect(result.order.packages.map((item) => item.code)).toEqual(['PKG-001', 'PKG-002']);
    expect(result.order.recipient.name).toBe('Ana Torres');
    expect(result.order.deliveryAddress.district).toBe('San Borja');
  });

  it('rejects an order with zero packages and leaves the store empty', async () => {
    const { eventPublisher, module } = buildModule();

    await expect(
      module.createDeliveryOrder.execute(validCommand({ packages: [] })),
    ).rejects.toBeInstanceOf(DeliveryOrderValidationError);

    expect(eventPublisher.events).toHaveLength(0);
    await expect(
      module.repository.findByPublicCode(ORGANIZATION_ID, 'ORD-2026-0001'),
    ).resolves.toBeNull();
  });

  it('rejects an invalid delivery address at the application boundary', async () => {
    const { module } = buildModule();

    const error: unknown = await module.createDeliveryOrder
      .execute(
        validCommand({
          deliveryAddress: { addressLine: 'x', district: 'San Borja' },
        }),
      )
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DeliveryOrderValidationError);
    if (!(error instanceof DeliveryOrderValidationError)) {
      throw new Error('expected DeliveryOrderValidationError');
    }
    expect(error.details?.['issues']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'deliveryAddress.addressLine' }),
      ]),
    );
  });

  it('rejects an invalid recipient at the application boundary', async () => {
    const { module } = buildModule();

    const error: unknown = await module.createDeliveryOrder
      .execute(
        validCommand({
          recipient: { name: 'Ana Torres', phone: 'call-me' },
        }),
      )
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DeliveryOrderValidationError);
    if (!(error instanceof DeliveryOrderValidationError)) {
      throw new Error('expected DeliveryOrderValidationError');
    }
    expect(error.details?.['issues']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'recipient.phone' }),
      ]),
    );
  });

  it('rejects invalid recipient and address values inside the domain layer', () => {
    expect(() => Recipient.create({ name: '   ', phone: '+51 987 654 321' })).toThrow(
      DeliveryOrderValidationError,
    );
    expect(() =>
      DeliveryAddress.create({ addressLine: 'Av. Siempre Viva 742', district: '   ' }),
    ).toThrow(DeliveryOrderValidationError);
  });

  it('rejects a duplicate public code within the same organization', async () => {
    const { eventPublisher, module } = buildModule();

    await module.createDeliveryOrder.execute(validCommand());

    await expect(
      module.createDeliveryOrder.execute(validCommand()),
    ).rejects.toBeInstanceOf(DeliveryOrderInvariantError);
    expect(eventPublisher.events).toHaveLength(1);
  });

  it('records a DeliveryOrderCreated event after storing the order', async () => {
    const { eventPublisher, module } = buildModule();

    const result = await module.createDeliveryOrder.execute(validCommand());

    expect(eventPublisher.events).toHaveLength(1);
    const [event] = eventPublisher.events;
    expect(event).toBeInstanceOf(DeliveryOrderCreated);
    if (!(event instanceof DeliveryOrderCreated)) {
      throw new Error('expected DeliveryOrderCreated');
    }
    expect(event.name).toBe('delivery-order.created');
    expect(event.aggregateId).toBe(result.order.id);
    expect(event.organizationId).toBe(ORGANIZATION_ID);
    expect(event.publicCode).toBe('ORD-2026-0001');
    expect(event.occurredAt).toBe(CREATED_AT);
  });
});
