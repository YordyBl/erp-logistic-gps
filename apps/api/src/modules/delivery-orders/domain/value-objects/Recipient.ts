import { DeliveryOrderValidationError } from '../errors/DeliveryOrderError.js';
import { requireTrimmedText } from './validation.js';

export interface RecipientInput {
  readonly name: string;
  readonly phone: string;
}

const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]*$/;
const MIN_PHONE_DIGITS = 6;
const MAX_PHONE_DIGITS = 15;

/**
 * Person who receives the order at the delivery address.
 *
 * Immutable and validated at construction. The phone is required for the MVP
 * because the driver needs a way to contact the recipient; rules for masking it
 * in logs and public tracking belong to the infrastructure/public-tracking
 * layers.
 */
export class Recipient {
  readonly name: string;
  readonly phone: string;

  private constructor(name: string, phone: string) {
    this.name = name;
    this.phone = phone;
    Object.freeze(this);
  }

  static create(input: RecipientInput): Recipient {
    const name = requireTrimmedText(input.name, 'recipient.name', 1, 120);
    const phone = this.normalizePhone(input.phone);

    return new Recipient(name, phone);
  }

  private static normalizePhone(value: unknown): string {
    const phone = requireTrimmedText(value, 'recipient.phone', 6, 20);

    if (!PHONE_PATTERN.test(phone)) {
      throw new DeliveryOrderValidationError(
        'recipient.phone may contain digits, spaces, parentheses, hyphens and an optional leading +',
        { field: 'recipient.phone' },
      );
    }

    const digits = phone.replace(/\D/g, '');
    if (digits.length < MIN_PHONE_DIGITS || digits.length > MAX_PHONE_DIGITS) {
      throw new DeliveryOrderValidationError(
        `recipient.phone must contain between ${MIN_PHONE_DIGITS} and ${MAX_PHONE_DIGITS} digits`,
        { field: 'recipient.phone' },
      );
    }

    return phone;
  }
}
