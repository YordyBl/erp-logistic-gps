import type { DataSource } from 'typeorm';

import type { OrganizationRepository } from '../../application/ports/OrganizationRepository.js';
import type { Organization } from '../../domain/entities/Organization.js';
import { OrganizationEntity } from './entities/OrganizationEntity.js';
import {
  toOrganizationDomain,
  toOrganizationEntity,
} from './mappers/OrganizationMapper.js';

/** PostgreSQL adapter for the {@link OrganizationRepository} port. */
export class OrganizationTypeOrmRepository implements OrganizationRepository {
  constructor(private readonly dataSource: DataSource) {}

  async save(organization: Organization): Promise<void> {
    await this.dataSource
      .getRepository(OrganizationEntity)
      .save(toOrganizationEntity(organization));
  }

  async findById(organizationId: string): Promise<Organization | null> {
    const entity = await this.dataSource
      .getRepository(OrganizationEntity)
      .findOne({ where: { id: organizationId } });

    return entity === null ? null : toOrganizationDomain(entity);
  }
}
