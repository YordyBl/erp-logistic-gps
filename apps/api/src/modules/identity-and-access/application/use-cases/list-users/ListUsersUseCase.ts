import { z } from 'zod';

import { toUserDto, type UserDto } from '../../dto/IdentityDto.js';
import type { UserRepository } from '../../ports/UserRepository.js';
import { toIdentityValidationError } from '../../validation.js';
import { requireActiveAdmin } from '../shared/require-active-admin.js';

const listUsersCommandSchema = z.strictObject({
  organizationId: z.uuid(),
  actorUserId: z.uuid(),
});

export interface ListUsersResult {
  readonly users: readonly UserDto[];
}

/** Every account of the ADMIN's organization, for the user administration screen. */
export class ListUsersUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(input: unknown): Promise<ListUsersResult> {
    const parsed = listUsersCommandSchema.safeParse(input);
    if (!parsed.success) {
      throw toIdentityValidationError(parsed.error, 'List users command is invalid');
    }
    const { organizationId, actorUserId } = parsed.data;

    await requireActiveAdmin(this.users, actorUserId, organizationId);
    const users = await this.users.listByOrganization(organizationId);

    return { users: users.map(toUserDto) };
  }
}
