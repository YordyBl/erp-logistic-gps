import { z } from 'zod';

import { PUBLIC_CODE_PATTERN } from '../../../domain/entities/DeliveryOrder.js';
import { DeliveryOrderValidationError } from '../../../domain/errors/DeliveryOrderError.js';

const recipientSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  phone: z
    .string()
    .trim()
    .min(6)
    .max(20)
    .regex(
      /^\+?[0-9][0-9 ()-]*$/,
      'phone may contain digits, spaces, parentheses, hyphens and an optional leading +',
    ),
});

/**
 * Every order must be placed on the map: route stops copy the order's
 * coordinates, so an unlocated order could never be routed or tracked. The
 * Google Maps link is only a reference; clients resolve it to coordinates
 * (`POST /delivery-orders/resolve-map-link`) before submitting.
 */
export const deliveryAddressSchema = z.strictObject({
  addressLine: z.string().trim().min(5).max(200),
  district: z.string().trim().min(2).max(80),
  googleMapsUrl: z.string().trim().url().max(2048).optional(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

export const deliveryOrderPackageSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
      'code may contain letters, digits, hyphens and underscores, and must start with a letter or digit',
    ),
  description: z.string().trim().min(1).max(200),
  weightKg: z.number().finite().positive().max(1000).optional(),
});

/**
 * External input contract for creating a delivery order.
 *
 * `organizationId` is supplied by the authenticated request context in the
 * future HTTP adapter; it must never be trusted from a request body. Validation
 * lives here because this is the application boundary (ADR-001 rule 8).
 */
export const createDeliveryOrderCommandSchema = z.strictObject({
  organizationId: z.uuid(),
  customerId: z.uuid(),
  timeWindow: z.enum(['AM', 'PM']),
  publicCode: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(
      z
        .string()
        .min(3)
        .max(32)
        .regex(
          PUBLIC_CODE_PATTERN,
          'publicCode must contain letters, digits and separating hyphens',
        ),
    )
    .optional(),
  recipient: recipientSchema,
  deliveryAddress: deliveryAddressSchema,
  packages: z.array(deliveryOrderPackageSchema.extend({
    code: deliveryOrderPackageSchema.shape.code.optional(),
  })).min(1).max(100),
});

export type CreateDeliveryOrderCommand = z.infer<typeof createDeliveryOrderCommandSchema>;

/**
 * Parses untrusted input and converts Zod failures into the module's typed
 * validation error. Raw input is never echoed into the error details because it
 * contains recipient personal data.
 */
export function parseCreateDeliveryOrderCommand(
  input: unknown,
): CreateDeliveryOrderCommand {
  const result = createDeliveryOrderCommandSchema.safeParse(input);

  if (!result.success) {
    throw new DeliveryOrderValidationError('Create delivery order command is invalid', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map((segment) => String(segment)).join('.'),
        message: issue.message,
      })),
    });
  }

  return result.data;
}
