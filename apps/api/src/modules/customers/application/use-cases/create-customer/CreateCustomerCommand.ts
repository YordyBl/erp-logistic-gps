import { z } from 'zod';

import {
  contactEmailSchema,
  contactPhoneSchema,
  customerCodeSchema,
  customerStatusSchema,
  toCustomerValidationError,
} from '../../validation.js';

/**
 * External input contract for creating a customer.
 *
 * `organizationId` is supplied by the authenticated request context, never by a
 * request body. Validation lives at this boundary because this is where
 * untrusted input enters the application (ADR-001 rule 8).
 */
export const createCustomerCommandSchema = z.strictObject({
  organizationId: z.uuid(),
  publicCode: customerCodeSchema,
  name: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(120),
  contactEmail: contactEmailSchema,
  contactPhone: contactPhoneSchema,
  status: customerStatusSchema.default('active'),
});

export type CreateCustomerCommand = z.infer<typeof createCustomerCommandSchema>;

export function parseCreateCustomerCommand(input: unknown): CreateCustomerCommand {
  const result = createCustomerCommandSchema.safeParse(input);

  if (!result.success) {
    throw toCustomerValidationError(result.error, 'Create customer command is invalid');
  }

  return result.data;
}
