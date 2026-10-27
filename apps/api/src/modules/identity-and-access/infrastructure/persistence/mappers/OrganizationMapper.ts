import { Organization } from '../../../domain/entities/Organization.js';
import { OrganizationEntity } from '../entities/OrganizationEntity.js';

/** Explicit domain ⇄ TypeORM mapping for organizations. */
export function toOrganizationEntity(organization: Organization): OrganizationEntity {
  const entity = new OrganizationEntity();

  entity.id = organization.id;
  entity.name = organization.name;
  entity.createdAt = new Date(organization.createdAt);

  return entity;
}

export function toOrganizationDomain(entity: OrganizationEntity): Organization {
  return Organization.create({
    id: entity.id,
    name: entity.name,
    createdAt: entity.createdAt.toISOString(),
  });
}
