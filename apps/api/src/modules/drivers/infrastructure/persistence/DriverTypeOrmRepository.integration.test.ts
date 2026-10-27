import { randomUUID } from 'node:crypto';

import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDataSource } from '../../../../infrastructure/database/data-source.js';
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
