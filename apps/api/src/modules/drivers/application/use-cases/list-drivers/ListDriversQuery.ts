import { z } from 'zod';

import { toDriverValidationError } from '../../validation.js';

/** Tenant scope of the driver list, always supplied by the request context. */
export const listDriversQuerySchema = z.strictObject({
  organizationId: z.uuid(),
});

export type ListDriversQuery = z.infer<typeof listDriversQuerySchema>;

export function parseListDriversQuery(input: unknown): ListDriversQuery {
  const result = listDriversQuerySchema.safeParse(input);

  if (!result.success) {
    throw toDriverValidationError(result.error, 'List drivers query is invalid');
  }

  return result.data;
}
