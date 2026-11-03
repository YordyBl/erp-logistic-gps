import type { DeliveryOrder } from '../../domain/entities/DeliveryOrder.js';
import type { DeliveryOrderStatus } from '../../domain/policies/DeliveryOrderStatusPolicy.js';

export interface DeliveryOrderRecipientDto {
  readonly name: string;
  readonly phone: string;
}

export interface DeliveryOrderAddressDto {
  readonly addressLine: string;
  readonly district: string;
  readonly googleMapsUrl: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

export interface DeliveryOrderPackageDto {
  readonly code: string;
  readonly description: string;
  readonly weightKg: number | null;
}

/**
 * Serializable output contract shared by the create/get slices.
 *
 * Optional domain values become explicit `null` so HTTP clients do not have to
 * interpret missing keys as "absent" versus "unknown".
 */
export interface DeliveryOrderDto {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId: string;
  readonly timeWindow: 'AM' | 'PM';
  readonly publicCode: string;
  readonly status: DeliveryOrderStatus;
  readonly recipient: DeliveryOrderRecipientDto;
  readonly deliveryAddress: DeliveryOrderAddressDto;
  readonly packages: readonly DeliveryOrderPackageDto[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toDeliveryOrderDto(order: DeliveryOrder): DeliveryOrderDto {
  return {
    id: order.id,
    organizationId: order.organizationId,
    customerId: order.customerId,
    timeWindow: order.timeWindow,
    publicCode: order.publicCode,
    status: order.status,
    recipient: {
      name: order.recipient.name,
      phone: order.recipient.phone,
    },
    deliveryAddress: {
      addressLine: order.deliveryAddress.addressLine,
      district: order.deliveryAddress.district,
      googleMapsUrl: order.deliveryAddress.googleMapsUrl ?? null,
      latitude: order.deliveryAddress.latitude ?? null,
      longitude: order.deliveryAddress.longitude ?? null,
    },
    packages: order.packages.map((item) => ({
      code: item.code,
      description: item.description,
      weightKg: item.weightKg ?? null,
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
