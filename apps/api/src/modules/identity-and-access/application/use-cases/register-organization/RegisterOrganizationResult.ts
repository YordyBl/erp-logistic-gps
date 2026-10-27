import type { OrganizationDto } from '../../dto/IdentityDto.js';

export interface RegisterOrganizationResult {
  readonly organization: OrganizationDto;
}
