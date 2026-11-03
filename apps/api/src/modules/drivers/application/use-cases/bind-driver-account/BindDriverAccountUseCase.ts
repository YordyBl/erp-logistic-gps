import { z } from 'zod';

import type { Clock } from '../../ports/Clock.js';
import type { DriverAccountBindingStore } from '../../ports/DriverAccountBindingStore.js';
import { DriverValidationError } from '../../../domain/errors/DriverError.js';

export const bindDriverAccountBodySchema = z.strictObject({ userId: z.uuid().nullable() });
const commandSchema = bindDriverAccountBodySchema.extend({
  organizationId: z.uuid(), driverId: z.uuid(), actorUserId: z.uuid(),
});

/** The transport enforces ADMIN; the store validates tenant, role and uniqueness atomically. */
export class BindDriverAccountUseCase {
  constructor(private readonly store: DriverAccountBindingStore,
    private readonly clock: Clock) {}

  async execute(input: unknown) {
    const result = commandSchema.safeParse(input);
    if (!result.success) {
      throw new DriverValidationError('Bind driver account command is invalid', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'), message: issue.message,
        })),
      });
    }
    const { organizationId, driverId, actorUserId, userId } = result.data;
    return { binding: await this.store.bind(organizationId, driverId, userId,
      actorUserId, this.clock.now()) };
  }

  async get(organizationId: string, driverId: unknown) {
    const result = z.strictObject({ organizationId: z.uuid(), driverId: z.uuid() })
      .safeParse({ organizationId, driverId });
    if (!result.success) throw new DriverValidationError('Get driver account query is invalid');
    return { binding: await this.store.get(result.data.organizationId, result.data.driverId) };
  }

  async listAccounts(organizationId: string) {
    const result = z.uuid().safeParse(organizationId);
    if (!result.success) throw new DriverValidationError('List driver accounts query is invalid');
    return { accounts: await this.store.listAccounts(result.data) };
  }
}
