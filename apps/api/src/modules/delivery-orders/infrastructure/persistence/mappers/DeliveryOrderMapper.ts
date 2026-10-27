import { generateUuidV4 } from '../../../../../shared/ids.js';
import { DeliveryOrder } from '../../../domain/entities/DeliveryOrder.js';
import { DeliveryOrderInvariantError } from '../../../domain/errors/DeliveryOrderError.js';
import { INITIAL_DELIVERY_ORDER_STATUS } from '../../../domain/policies/DeliveryOrderStatusPolicy.js';
import { DeliveryAddress } from '../../../domain/value-objects/DeliveryAddress.js';
import { Package } from '../../../domain/value-objects/Package.js';
import { Recipient } from '../../../domain/value-objects/Recipient.js';
import { DeliveryOrderEntity } from '../entities/DeliveryOrderEntity.js';
import { DeliveryOrderPackageEntity } from '../entities/DeliveryOrderPackageEntity.js';

/**
 * Explicit domain ⇄ TypeORM mapping for the `DeliveryOrder` aggregate.
 *
 * Mapping lives in one place so schema changes never leak into the domain
 * (ADR-002 §2). `numeric` columns arrive from `pg` as strings, so numeric
 * conversions happen here; no floating point is used for stored measurements.
 */
export function toOrderEntity(order: DeliveryOrder): DeliveryOrderEntity {
  const entity = new DeliveryOrderEntity();

  entity.id = order.id;
  entity.organizationId = order.organizationId;
  entity.publicCode = order.publicCode;
  entity.recipientName = order.recipient.name;
  entity.recipientPhone = order.recipient.phone;
  entity.deliveryAddressLine = order.deliveryAddress.addressLine;
  entity.deliveryDistrict = order.deliveryAddress.district;
  entity.latitude = numberToNumeric(order.deliveryAddress.latitude);
  entity.longitude = numberToNumeric(order.deliveryAddress.longitude);
  entity.status = order.status;
  entity.createdAt = new Date(order.createdAt);
  entity.updatedAt = new Date(order.updatedAt);

  return entity;
}

export function toPackageEntities(order: DeliveryOrder): DeliveryOrderPackageEntity[] {
  return order.packages.map((item, position) => {
    const entity = new DeliveryOrderPackageEntity();

    entity.id = generateUuidV4();
    entity.deliveryOrderId = order.id;
    entity.position = position;
    entity.code = item.code;
    entity.description = item.description;
    entity.weightKg = numberToNumeric(item.weightKg);

    return entity;
  });
}

export function toDomain(
  orderEntity: DeliveryOrderEntity,
  packageEntities: readonly DeliveryOrderPackageEntity[],
): DeliveryOrder {
  if (orderEntity.status !== INITIAL_DELIVERY_ORDER_STATUS) {
    throw new Error(
      `Persisted delivery order ${orderEntity.id} has status "${orderEntity.status}", ` +
        'but the pilot domain only models the initial "created" status. ' +
        'Reintroduce the status transition use case before reading such a row.',
    );
  }

  const packages = [...packageEntities]
    .sort((left, right) => left.position - right.position)
    .map((item) =>
      Package.create({
        code: item.code,
        description: item.description,
        weightKg: numericToNumber(item.weightKg, 'weight_kg') ?? undefined,
      }),
    );

  return DeliveryOrder.create({
    id: orderEntity.id,
    organizationId: orderEntity.organizationId,
    publicCode: orderEntity.publicCode,
    recipient: Recipient.create({
      name: orderEntity.recipientName,
      phone: orderEntity.recipientPhone,
    }),
    deliveryAddress: DeliveryAddress.create({
      addressLine: orderEntity.deliveryAddressLine,
      district: orderEntity.deliveryDistrict,
      latitude: numericToNumber(orderEntity.latitude, 'latitude') ?? undefined,
      longitude: numericToNumber(orderEntity.longitude, 'longitude') ?? undefined,
    }),
    packages,
    createdAt: orderEntity.createdAt.toISOString(),
  });
}

function numberToNumeric(value: number | undefined): string | null {
  return value === undefined ? null : String(value);
}

function numericToNumber(value: string | null, field: string): number | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new DeliveryOrderInvariantError(
      `Persisted column ${field} is not a finite number`,
      { field },
    );
  }

  return parsed;
}
