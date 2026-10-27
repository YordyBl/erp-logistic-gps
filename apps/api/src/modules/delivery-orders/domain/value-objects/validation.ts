import { DeliveryOrderValidationError } from '../errors/DeliveryOrderError.js';

/**
 * Plain-TypeScript validation helpers shared by the module value objects.
 *
 * Domain invariants are enforced here, not with Zod: Zod belongs to the
 * application boundary and must never be a domain dependency (ADR-001 rule 1).
 */
export function requireTrimmedText(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number,
): string {
  if (typeof value !== 'string') {
    throw new DeliveryOrderValidationError(`${field} must be a string`, { field });
  }

  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new DeliveryOrderValidationError(
      `${field} must contain between ${minLength} and ${maxLength} characters`,
      { field },
    );
  }

  return normalized;
}

export function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DeliveryOrderValidationError(`${field} must be a finite number`, { field });
  }

  return value;
}
