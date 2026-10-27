import { describe, expect, it } from 'vitest';

import { IdentityValidationError } from '../domain/errors/IdentityError.js';
import { buildTestModule, NOW } from './support/fixtures.js';

describe('RegisterOrganization', () => {
  it('creates an organization with a UUID and a trimmed name', async () => {
    const { module } = buildTestModule();

    const result = await module.registerOrganization.execute({
      name: '   Lima Express   ',
    });

    expect(result.organization.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(result.organization.name).toBe('Lima Express');
    expect(result.organization.createdAt).toBe(NOW);
    await expect(module.organizations.findById(result.organization.id)).resolves.toMatchObject({
      id: result.organization.id,
      name: 'Lima Express',
    });
  });

  it('rejects a blank name and stores nothing', async () => {
    const { module } = buildTestModule();

    await expect(module.registerOrganization.execute({ name: '   ' })).rejects.toBeInstanceOf(
      IdentityValidationError,
    );
    await expect(
      module.organizations.findById('00000000-0000-4000-8000-000000000001'),
    ).resolves.toBeNull();
  });

  it('rejects names outside the 2-120 character range', async () => {
    const { module } = buildTestModule();

    await expect(module.registerOrganization.execute({ name: 'A' })).rejects.toBeInstanceOf(
      IdentityValidationError,
    );
    await expect(
      module.registerOrganization.execute({ name: 'A'.repeat(121) }),
    ).rejects.toBeInstanceOf(IdentityValidationError);
  });
});
