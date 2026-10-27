import { DeliveryOrderValidationError } from '../errors/DeliveryOrderError.js';
import { requireFiniteNumber, requireTrimmedText } from './validation.js';

export interface DeliveryAddressInput {
  readonly addressLine: string;
  readonly district: string;
  readonly latitude?: number | undefined;
  readonly longitude?: number | undefined;
}

/**
 * Where the order must be delivered.
 *
 * The MVP covers Lima Metropolitana and Callao, but district names are free text
 * until the geographic catalogue and PostGIS decision are ratified (architecture
 * plan §11.10). Coordinates are optional; when present they must be a valid
 * pair, because a single coordinate cannot place a stop on a map.
 */
export class DeliveryAddress {
  readonly addressLine: string;
  readonly district: string;
  readonly latitude: number | undefined;
  readonly longitude: number | undefined;

  private constructor(
    addressLine: string,
    district: string,
    latitude: number | undefined,
    longitude: number | undefined,
  ) {
    this.addressLine = addressLine;
    this.district = district;
    this.latitude = latitude;
    this.longitude = longitude;
    Object.freeze(this);
  }

  static create(input: DeliveryAddressInput): DeliveryAddress {
    const addressLine = requireTrimmedText(
      input.addressLine,
      'deliveryAddress.addressLine',
      5,
      200,
    );
    const district = requireTrimmedText(input.district, 'deliveryAddress.district', 2, 80);

    const hasLatitude = input.latitude !== undefined;
    const hasLongitude = input.longitude !== undefined;

    if (hasLatitude !== hasLongitude) {
      throw new DeliveryOrderValidationError(
        'deliveryAddress.latitude and deliveryAddress.longitude must be provided together',
        { field: 'deliveryAddress.coordinates' },
      );
    }

    if (!hasLatitude || !hasLongitude) {
      return new DeliveryAddress(addressLine, district, undefined, undefined);
    }

    const latitude = requireFiniteNumber(input.latitude, 'deliveryAddress.latitude');
    const longitude = requireFiniteNumber(input.longitude, 'deliveryAddress.longitude');

    if (latitude < -90 || latitude > 90) {
      throw new DeliveryOrderValidationError(
        'deliveryAddress.latitude must be between -90 and 90',
        { field: 'deliveryAddress.latitude' },
      );
    }

    if (longitude < -180 || longitude > 180) {
      throw new DeliveryOrderValidationError(
        'deliveryAddress.longitude must be between -180 and 180',
        { field: 'deliveryAddress.longitude' },
      );
    }

    return new DeliveryAddress(addressLine, district, latitude, longitude);
  }
}
