import { DeliveryOrderValidationError } from '../errors/DeliveryOrderError.js';
import { requireFiniteNumber, requireTrimmedText } from './validation.js';

export interface PackageInput {
  readonly code: string;
  readonly description: string;
  readonly weightKg?: number | undefined;
}

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,39}$/;
const MAX_WEIGHT_KG = 1000;

/**
 * One physical parcel inside a delivery order.
 *
 * Packages are value objects of the `DeliveryOrder` aggregate in this pilot: an
 * order has one or more, they never move between orders, and their codes are
 * unique inside the order. Persistence will still give each row a UUID, but it
 * is an infrastructure concern and not part of the aggregate contract yet.
 */
export class Package {
  readonly code: string;
  readonly description: string;
  readonly weightKg: number | undefined;

  private constructor(code: string, description: string, weightKg: number | undefined) {
    this.code = code;
    this.description = description;
    this.weightKg = weightKg;
    Object.freeze(this);
  }

  static create(input: PackageInput): Package {
    const rawCode = requireTrimmedText(input.code, 'packages[].code', 1, 40);
    const code = rawCode.toUpperCase();

    if (!CODE_PATTERN.test(code)) {
      throw new DeliveryOrderValidationError(
        'packages[].code may contain letters, digits, hyphens and underscores, and must start with a letter or digit',
        { field: 'packages[].code' },
      );
    }

    const description = requireTrimmedText(input.description, 'packages[].description', 1, 200);

    let weightKg: number | undefined;
    if (input.weightKg !== undefined) {
      weightKg = requireFiniteNumber(input.weightKg, 'packages[].weightKg');
      if (weightKg <= 0 || weightKg > MAX_WEIGHT_KG) {
        throw new DeliveryOrderValidationError(
          `packages[].weightKg must be greater than 0 and at most ${MAX_WEIGHT_KG}`,
          { field: 'packages[].weightKg' },
        );
      }
    }

    return new Package(code, description, weightKg);
  }
}
