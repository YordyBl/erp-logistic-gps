import { Organization } from '../../../domain/entities/Organization.js';
import { toOrganizationDto } from '../../dto/IdentityDto.js';
import type { Clock } from '../../ports/Clock.js';
import type { IdGenerator } from '../../ports/IdGenerator.js';
import type { OrganizationRepository } from '../../ports/OrganizationRepository.js';
import { parseRegisterOrganizationCommand } from './RegisterOrganizationCommand.js';
import type { RegisterOrganizationResult } from './RegisterOrganizationResult.js';

export interface RegisterOrganizationDependencies {
  readonly organizations: OrganizationRepository;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Creates a tenant organization.
 *
 * This is the bootstrap path for the demo seed and the first customer setup.
 * User provisioning is a separate ADMIN-only use case, so registering an
 * organization never grants access by itself.
 */
export class RegisterOrganizationUseCase {
  constructor(
    private readonly dependencies: RegisterOrganizationDependencies,
  ) {}

  async execute(input: unknown): Promise<RegisterOrganizationResult> {
    const command = parseRegisterOrganizationCommand(input);

    const organization = Organization.create({
      id: this.dependencies.idGenerator.nextId(),
      name: command.name,
      createdAt: this.dependencies.clock.now(),
    });

    await this.dependencies.organizations.save(organization);

    return { organization: toOrganizationDto(organization) };
  }
}
