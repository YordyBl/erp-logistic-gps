import { randomUUID } from 'node:crypto';

import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDataSource } from '../../../../infrastructure/database/data-source.js';
import type { DriverPageCriteria } from '../../application/ports/DriverRepository.js';
import { InMemoryDriverRepository } from '../../composition/composition-root.js';
import { Driver } from '../../domain/entities/Driver.js';
import { DriverInvariantError } from '../../domain/errors/DriverError.js';
import { probeDriversDatabase } from '../../tests/support/test-database.js';
import { DriverTypeOrmRepository } from './DriverTypeOrmRepository.js';

const CREATED_AT = '2026-10-27T15:00:00.000Z';
const UPDATED_AT = '2026-10-27T16:00:00.000Z';

const database = await probeDriversDatabase();

if (!database.available) {
  process.stderr.write(
    `[drivers:integration] Skipping PostgreSQL adapter tests: ${database.reason}. ` +
      'Start the compose PostgreSQL service and set DATABASE_URL to run them.\n',
  );
}

const databaseUrl = database.available ? database.url : null;

describe.skipIf(databaseUrl === null)('drivers persistence (PostgreSQL)', () => {
  let dataSource: DataSource | undefined;
  let repository: DriverTypeOrmRepository | undefined;
  const createdOrganizationIds: string[] = [];

  beforeAll(async () => {
    if (databaseUrl === null) {
      return;
    }

    dataSource = createDataSource({ url: databaseUrl });
    await dataSource.initialize();
    repository = new DriverTypeOrmRepository(dataSource);
  });

  afterAll(async () => {
    if (dataSource === undefined || !dataSource.isInitialized) {
      return;
    }

    for (const organizationId of createdOrganizationIds) {
      await dataSource.query('DELETE FROM driver_accounts WHERE organization_id = $1', [organizationId]);
      await dataSource.query('DELETE FROM users WHERE organization_id = $1', [organizationId]);
      await dataSource.query('DELETE FROM drivers WHERE organization_id = $1', [
        organizationId,
      ]);
      await dataSource.query('DELETE FROM organizations WHERE id = $1', [
        organizationId,
      ]);
    }

    await dataSource.destroy();
  });

  async function newOrganization(): Promise<string> {
    const organizationId = randomUUID();

    if (dataSource === undefined) {
      throw new Error('dataSource was not initialized');
    }

    await dataSource.query(
      `INSERT INTO organizations (id, name, created_at) VALUES ($1, $2, now())`,
      [organizationId, 'Driver Integration Test'],
    );
    createdOrganizationIds.push(organizationId);

    return organizationId;
  }

  function required<T>(value: T | undefined, name: string): T {
    if (value === undefined) {
      throw new Error(`${name} was not initialized`);
    }

    return value;
  }

  function newDriver(organizationId: string, documentNumber: string): Driver {
    return Driver.create({
      id: randomUUID(),
      organizationId,
      fullName: 'Luis Quispe',
      documentNumber,
      phone: '+51 911 222 333',
      licenseNumber: 'Q-987654',
      createdAt: CREATED_AT,
    });
  }

  it('round-trips an updated driver and scopes every read by organization', async () => {
    const organizationId = await newOrganization();
    const otherOrganizationId = await newOrganization();
    const driver = newDriver(organizationId, 'DNI-12345678');
    const other = newDriver(otherOrganizationId, 'DNI-87654321');
    const store = required(repository, 'repository');

    await store.save(driver);
    await store.save(other);
    await store.save(
      driver.withChanges({ fullName: 'Luis Quispe Rojas' }, UPDATED_AT),
    );

    const loaded = await store.findById(organizationId, driver.id);
    expect(loaded).toMatchObject({
      fullName: 'Luis Quispe Rojas',
      documentNumber: 'DNI-12345678',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });

    await expect(
      store.findByDocumentNumber(organizationId, 'DNI-12345678'),
    ).resolves.toMatchObject({ id: driver.id });
    await expect(
      store.findByDocumentNumber(otherOrganizationId, 'DNI-12345678'),
    ).resolves.toBeNull();
    await expect(store.findById(otherOrganizationId, driver.id)).resolves.toBeNull();

    const listed = await store.list(organizationId);
    expect(listed.map((item) => item.id)).toEqual([driver.id]);
  });

  it('pages, filters, searches and counts like the in-memory adapter', async () => {
    const ownerId = await newOrganization();
    const foreignId = await newOrganization();
    const store = required(repository, 'repository');
    const source = required(dataSource, 'dataSource');
    const memory = new InMemoryDriverRepository();
    const variant = (organizationId: string, fullName: string, code: string, phone: string, createdAt: string,
      status: 'active' | 'inactive' = 'active') => Driver.create({
      id: randomUUID(), organizationId, fullName, documentNumber: `DNI-${code}`, licenseNumber: `L-${code}`,
      phone, status, createdAt,
    });
    const drivers = [
      variant(ownerId, 'Valeria Gómez', '100', '911 111 111', '2026-10-27T15:00:00.000Z'),
      variant(ownerId, 'Bruno Díaz_Ruiz', '200', '922 222 222', '2026-10-27T16:00:00.000Z'),
      variant(ownerId, 'Carla Ríos', '300', '933 333 333', '2026-10-27T16:00:00.000Z', 'inactive'),
      variant(ownerId, 'Ana Quispe 100%', '400', '944 444 444', '2026-10-27T17:00:00.000Z'),
      variant(foreignId, 'Ana Foránea', '100', '955 555 555', '2026-10-27T18:00:00.000Z'),
    ];
    for (const driver of drivers) {
      await store.save(driver);
      await memory.save(driver);
    }
    const accountId = randomUUID();
    await source.query(`INSERT INTO users (id, organization_id, email, password_hash, role, status, created_at)
      VALUES ($1, $2, $3, 'test-only-hash', 'DRIVER', 'active', now())`, [accountId, ownerId, `${accountId}@example.test`]);
    await source.query(`INSERT INTO driver_accounts (organization_id, driver_id, user_id) VALUES ($1, $2, $3)`,
      [ownerId, drivers[1]!.id, accountId]);
    memory.useAccountLinks(() => new Set([drivers[1]!.id]));

    const base = { page: 1, pageSize: 20, sort: { field: 'fullName', direction: 'asc' } } as const;
    const scenarios: DriverPageCriteria[] = [
      base,
      { ...base, page: 2, pageSize: 3 },
      { ...base, sort: { field: 'fullName', direction: 'desc' } },
      { ...base, sort: { field: 'createdAt', direction: 'asc' } },
      { ...base, sort: { field: 'createdAt', direction: 'desc' } },
      { ...base, status: ['inactive'] },
      { ...base, account: 'linked' },
      { ...base, account: 'unlinked', status: ['active'] },
      { ...base, q: 'gomez' },
      { ...base, q: 'DÍAZ' },
      { ...base, q: 'dni-300' },
      { ...base, q: 'l-400' },
      { ...base, q: '911 111' },
      { ...base, q: '100%' },
      { ...base, q: '_' },
      { ...base, q: 'ana', account: 'linked' },
      { ...base, ids: [drivers[0]!.id, drivers[4]!.id] },
      { ...base, page: 9 },
    ];
    for (const criteria of scenarios) {
      const [stored, inMemory] = await Promise.all([
        store.listPage(ownerId, criteria),
        memory.listPage(ownerId, criteria),
      ]);
      expect(stored, JSON.stringify(criteria)).toEqual(inMemory);
    }
  });

  it('enforces unique document number per organization and allows it across tenants', async () => {
    const organizationId = await newOrganization();
    const otherOrganizationId = await newOrganization();
    const store = required(repository, 'repository');

    await store.save(newDriver(organizationId, 'DNI-55555555'));

    await expect(
      store.save(newDriver(organizationId, 'DNI-55555555')),
    ).rejects.toBeInstanceOf(DriverInvariantError);

    await expect(
      store.save(newDriver(otherOrganizationId, 'DNI-55555555')),
    ).resolves.toBeUndefined();
  });
});
