import type { Organization } from '../../domain/entities/Organization.js';

/** Persistence contract for tenant organizations. */
export interface OrganizationRepository {
  save(organization: Organization): Promise<void>;
  findById(organizationId: string): Promise<Organization | null>;
}
