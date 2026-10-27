import type { UserDto } from '../../dto/IdentityDto.js';

export interface CreateUserResult {
  readonly user: UserDto;
}
