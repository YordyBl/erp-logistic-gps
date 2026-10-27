import { z } from 'zod';

import { toDriverValidationError } from '../../validation.js';

/** Tenant and identifier of one driver read. */
export const getDriverQuerySchema = z.strictObject({
  organizationId: z.uuid(),
  driverId: z.uuid(),
});

export type GetDriverQuery = z.infer<typeof getDriverQuerySchema>;

export function parseGetDriverQuery(input: unknown): GetDriverQuery {
  const result = getDriverQuerySchema.safeParse(input);

  if (!result.success) {
    throw toDriverValidationError(result.error, 'Get driver query is invalid');
  }

  return result.data;
}
