import { describe, expect, it } from 'vitest';

import { DeliveryOrder } from '../domain/entities/DeliveryOrder.js';
import {
  DeliveryOrderInvariantError,
  DeliveryOrderValidationError,
} from '../domain/errors/DeliveryOrderError.js';
import { DeliveryAddress } from '../domain/value-objects/DeliveryAddress.js';
import { Package } from '../domain/value-objects/Package.js';
import { Recipient } from '../domain/value-objects/Recipient.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CREATED_AT = '2026-10-26T15:00:00.000Z';

const recipient = Recipient.create({ name: 'Rosa Medina', phone: '+51 988 777 666' });
const deliveryAddress = DeliveryAddress.create({
  addressLine: 'Av. Arequipa 2500',
  district: 'Lince',
});
const firstPackage = Package.create({ code: 'PKG-001', description: 'Box' });

function orderProps(overrides: Partial<Parameters<typeof DeliveryOrder.create>[0]> = {}) {
  return {
    id: ORDER_ID,
    organizationId: ORGANIZATION_ID,
    publicCode: 'ORD-2026-0007',
    recipient,
    deliveryAddress,
    packages: [firstPackage],
    createdAt: CREATED_AT,
    ...overrides,
  };
}

describe('DeliveryOrder aggregate', () => {
  it('starts in created status with matching created and updated timestamps', () => {
    const order = DeliveryOrder.create(orderProps());

    expect(order.status).toBe('created');
    expect(order.createdAt).toBe(CREATED_AT);
    expect(order.updatedAt).toBe(CREATED_AT);
    expect(order.packages).toHaveLength(1);
  });

  it('requires at least one package', () => {
    expect(() => DeliveryOrder.create(orderProps({ packages: [] }))).toThrow(
      DeliveryOrderInvariantError,
    );
  });

  it('rejects duplicated package codes inside one order', () => {
    const duplicate = Package.create({ code: 'pkg-001', description: 'Second box' });

    expect(() => DeliveryOrder.create(orderProps({ packages: [firstPackage, duplicate] }))).toThrow(
      DeliveryOrderInvariantError,
    );
  });

  it('rejects malformed internal identifiers', () => {
    expect(() => DeliveryOrder.create(orderProps({ id: 'not-a-uuid' }))).toThrow(
      DeliveryOrderValidationError,
    );
    expect(() => DeliveryOrder.create(orderProps({ organizationId: 'tenant-1' }))).toThrow(
      DeliveryOrderValidationError,
    );
  });

  it('exposes an immutable package list', () => {
    const order = DeliveryOrder.create(orderProps());

    expect(Object.isFrozen(order.packages)).toBe(true);
  });
});

describe('Value objects', () => {
  it('freezes recipient, address and package instances', () => {
    expect(Object.isFrozen(recipient)).toBe(true);
    expect(Object.isFrozen(deliveryAddress)).toBe(true);
    expect(Object.isFrozen(firstPackage)).toBe(true);
  });

  it('normalizes readable codes to uppercase', () => {
    const item = Package.create({ code: 'pkg-200', description: 'Envelope' });

    expect(item.code).toBe('PKG-200');
  });

  it('rejects a non-positive package weight', () => {
    expect(() =>
      Package.create({ code: 'PKG-300', description: 'Box', weightKg: 0 }),
    ).toThrow(DeliveryOrderValidationError);
    expect(() =>
      Package.create({ code: 'PKG-301', description: 'Box', weightKg: Number.NaN }),
    ).toThrow(DeliveryOrderValidationError);
  });

  it('requires latitude and longitude together', () => {
    expect(() =>
      DeliveryAddress.create({
        addressLine: 'Av. Arequipa 2500',
        district: 'Lince',
        latitude: -12.1211,
      }),
    ).toThrow(DeliveryOrderValidationError);
  });

  it('rejects coordinates outside their valid range', () => {
    expect(() =>
      DeliveryAddress.create({
        addressLine: 'Av. Arequipa 2500',
        district: 'Lince',
        latitude: -91,
        longitude: -77.03,
      }),
    ).toThrow(DeliveryOrderValidationError);
  });

  it('rejects a recipient phone with an invalid shape', () => {
    expect(() => Recipient.create({ name: 'Rosa Medina', phone: 'call-me' })).toThrow(
      DeliveryOrderValidationError,
    );
  });
});
