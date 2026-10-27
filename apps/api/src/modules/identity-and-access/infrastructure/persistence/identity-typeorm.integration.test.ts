import { randomUUID } from 'node:crypto';

import { In, type DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDataSource } from '../../../../infrastructure/database/data-source.js';
import { Organization } from '../../domain/entities/Organization.js';
import { User } from '../../domain/entities/User.js';
import { EmailAlreadyInUseError } from '../../domain/errors/IdentityError.js';
import { OrganizationTypeOrmRepository } from './OrganizationTypeOrmRepository.js';
import { RefreshTokenTypeOrmStore } from './RefreshTokenTypeOrmStore.js';
import { UserTypeOrmRepository } from './UserTypeOrmRepository.js';
import { OrganizationEntity } from './entities/OrganizationEntity.js';
import { RefreshTokenEntity } from './entities/RefreshTokenEntity.js';
import { UserEntity } from './entities/UserEntity.js';
import { probeIdentityDatabase } from '../../tests/support/test-database.js';

const CREATED_AT = '2026-10-27T15:00:00.000Z';
const EXPIRES_AT = '2026-11-03T15:00:00.000Z';

const database = await probeIdentityDatabase();

if (!database.available) {
  process.stderr.write(
    `[identity-and-access:integration] Skipping PostgreSQL adapter tests: ${database.reason}. ` +
      'Start the compose PostgreSQL service and set DATABASE_URL to run them.\n',
  );
}

const databaseUrl = database.available ? database.url : null;

describe.skipIf(databaseUrl === null)('identity-and-access persistence (PostgreSQL)', () => {
  let dataSource: DataSource | undefined;
  let organizations: OrganizationTypeOrmRepository | undefined;
  let users: UserTypeOrmRepository | undefined;
  let refreshTokens: RefreshTokenTypeOrmStore | undefined;
  const createdOrganizationIds: string[] = [];

  beforeAll(async () => {
    if (databaseUrl === null) {
      return;
    }

    dataSource = createDataSource({ url: databaseUrl });
    await dataSource.initialize();
    organizations = new OrganizationTypeOrmRepository(dataSource);
    users = new UserTypeOrmRepository(dataSource);
    refreshTokens = new RefreshTokenTypeOrmStore(dataSource);
  });

  afterAll(async () => {
    if (dataSource === undefined || !dataSource.isInitialized) {
      return;
    }

    if (createdOrganizationIds.length > 0) {
      await dataSource.getRepository(RefreshTokenEntity).delete({
        organizationId: In(createdOrganizationIds),
      });
      await dataSource.getRepository(UserEntity).delete({
        organizationId: In(createdOrganizationIds),
      });
      await dataSource.getRepository(OrganizationEntity).delete({
        id: In(createdOrganizationIds),
      });
    }

    await dataSource.destroy();
  });

  function required<T>(value: T | undefined, name: string): T {
    if (value === undefined) {
      throw new Error(`${name} was not initialized`);
    }

    return value;
  }

  function newOrganization(name = 'Test Logistics'): Organization {
    const organization = Organization.create({
      id: randomUUID(),
      name,
      createdAt: CREATED_AT,
    });
    createdOrganizationIds.push(organization.id);
    return organization;
  }

  function newUser(
    organizationId: string,
    email: string,
    role: 'ADMIN' | 'DISPATCHER' | 'DRIVER' = 'ADMIN',
  ): User {
    return User.create({
      id: randomUUID(),
      organizationId,
      email,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$hash',
      role,
      status: 'active',
      createdAt: CREATED_AT,
    });
  }

  it('round-trips an organization', async () => {
    const organization = newOrganization('  Lima Express  ');

    await required(organizations, 'organizations').save(organization);
    const loaded = await required(organizations, 'organizations').findById(organization.id);

    expect(loaded).toEqual(organization);
    expect(loaded?.name).toBe('Lima Express');
    expect(loaded?.createdAt).toBe(CREATED_AT);
  });

  it('round-trips a user and scopes the email lookup by organization', async () => {
    const organization = newOrganization();
    const otherOrganization = newOrganization();
    const user = newUser(organization.id, 'ana@lima.test');

    await required(organizations, 'organizations').save(organization);
    await required(organizations, 'organizations').save(otherOrganization);
    await required(users, 'users').save(user);

    await expect(required(users, 'users').findById(user.id)).resolves.toEqual(user);
    await expect(
      required(users, 'users').findByEmail(organization.id, 'ana@lima.test'),
    ).resolves.toEqual(user);
    await expect(
      required(users, 'users').findByEmail(otherOrganization.id, 'ana@lima.test'),
    ).resolves.toBeNull();
  });

  it('enforces unique email per organization and allows it across organizations', async () => {
    const organization = newOrganization();
    const otherOrganization = newOrganization();
    await required(organizations, 'organizations').save(organization);
    await required(organizations, 'organizations').save(otherOrganization);

    const first = newUser(organization.id, 'duplicate@lima.test');
    const duplicate = newUser(organization.id, 'duplicate@lima.test');
    const sameEmailElsewhere = newUser(otherOrganization.id, 'duplicate@lima.test');

    await required(users, 'users').save(first);

    await expect(required(users, 'users').save(duplicate)).rejects.toBeInstanceOf(
      EmailAlreadyInUseError,
    );
    await expect(required(users, 'users').findById(duplicate.id)).resolves.toBeNull();
    await expect(required(users, 'users').save(sameEmailElsewhere)).resolves.toBeUndefined();
  });

  it('stores refresh tokens by hash and revokes one token atomically', async () => {
    const organization = newOrganization();
    await required(organizations, 'organizations').save(organization);
    const user = newUser(organization.id, 'session@lima.test');
    await required(users, 'users').save(user);

    const record = {
      id: randomUUID(),
      userId: user.id,
      organizationId: organization.id,
      familyId: randomUUID(),
      tokenHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      issuedAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
      revokedAt: null,
    };

    await required(refreshTokens, 'refreshTokens').save(record);
    await expect(
      required(refreshTokens, 'refreshTokens').findByHash(record.tokenHash),
    ).resolves.toEqual(record);

    await expect(
      required(refreshTokens, 'refreshTokens').revokeOne(record.id, CREATED_AT),
    ).resolves.toBe(true);
    await expect(
      required(refreshTokens, 'refreshTokens').revokeOne(record.id, CREATED_AT),
    ).resolves.toBe(false);
    await expect(
      required(refreshTokens, 'refreshTokens').findByHash(record.tokenHash),
    ).resolves.toMatchObject({ revokedAt: CREATED_AT });
  });

  it('revokes every live token of a family without touching other families', async () => {
    const organization = newOrganization();
    await required(organizations, 'organizations').save(organization);
    const user = newUser(organization.id, 'family@lima.test');
    await required(users, 'users').save(user);

    const familyId = randomUUID();
    const otherFamilyId = randomUUID();
    const buildRecord = (id: string, tokenHash: string) => ({
      id,
      userId: user.id,
      organizationId: organization.id,
      familyId,
      tokenHash,
      issuedAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
      revokedAt: null,
    });

    const first = buildRecord(randomUUID(), 'a'.repeat(64));
    const second = buildRecord(randomUUID(), 'b'.repeat(64));
    const other = {
      ...buildRecord(randomUUID(), 'c'.repeat(64)),
      familyId: otherFamilyId,
    };

    const store = required(refreshTokens, 'refreshTokens');
    await store.save(first);
    await store.save(second);
    await store.save(other);

    await store.revokeFamily(familyId, CREATED_AT);

    await expect(store.findByHash(first.tokenHash)).resolves.toMatchObject({
      revokedAt: CREATED_AT,
    });
    await expect(store.findByHash(second.tokenHash)).resolves.toMatchObject({
      revokedAt: CREATED_AT,
    });
    await expect(store.findByHash(other.tokenHash)).resolves.toMatchObject({
      revokedAt: null,
    });
  });
});
