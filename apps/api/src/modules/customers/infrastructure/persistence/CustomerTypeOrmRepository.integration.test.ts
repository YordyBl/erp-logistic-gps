import { randomUUID } from 'node:crypto';

import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDataSource } from '../../../../infrastructure/database/data-source.js';
import { Customer } from '../../domain/entities/Customer.js';
import { CustomerInvariantError } from '../../domain/errors/CustomerError.js';
import { probeCustomersDatabase } from '../../tests/support/test-database.js';
import { CustomerTypeOrmRepository } from './CustomerTypeOrmRepository.js';

const CREATED_AT = '2026-10-27T15:00:00.000Z';

const database = await probeCustomersDatabase();

if (!database.available) {
  process.stderr.write(
    `[customers:integration] Skipping PostgreSQL adapter tests: ${database.reason}. ` +
      'Start the compose PostgreSQL service and set DATABASE_URL to run them.\n',
  );
}

const databaseUrl = database.available ? database.url : null;

describe.skipIf(databaseUrl === null)('customers persistence (PostgreSQL)', () => {
  let dataSource: DataSource | undefined;
  let repository: CustomerTypeOrmRepository | undefined;
  const createdOrganizationIds: string[] = [];

  beforeAll(async () => {
    if (databaseUrl === null) {
      return;
    }

    dataSource = createDataSource({ url: databaseUrl });
    await dataSource.initialize();
    repository = new CustomerTypeOrmRepository(dataSource);
  });

  afterAll(async () => {
    if (dataSource === undefined || !dataSource.isInitialized) {
      return;
    }

    for (const organizationId of createdOrganizationIds) {
      await dataSource.query('DELETE FROM customers WHERE organization_id = $1', [
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
      [organizationId, 'Catalog Integration Test'],
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

  function newCustomer(
    organizationId: string,
    publicCode: string,
    createdAt = CREATED_AT,
  ): Customer {
    return Customer.create({
      id: randomUUID(),
      organizationId,
      publicCode,
      name: 'Distribuidora Lima SAC',
      contactName: 'Ana Torres',
      contactEmail: 'Contact@Distribuidora.PE',
      contactPhone: '+51 987 654 321',
      createdAt,
    });
  }

  it('round-trips a customer and scopes every read by organization', async () => {
    const organizationId = await newOrganization();
    const otherOrganizationId = await newOrganization();
    const customer = newCustomer(organizationId, 'cus-2026-0001');
    const other = newCustomer(otherOrganizationId, 'cus-2026-0002');

    const store = required(repository, 'repository');
    await store.save(customer);
    await store.save(other);

    await expect(store.findById(organizationId, customer.id)).resolves.toEqual(
      customer,
    );
    await expect(
      store.findByPublicCode(organizationId, 'CUS-2026-0001'),
    ).resolves.toEqual(customer);
    await expect(
      store.findByPublicCode(otherOrganizationId, 'CUS-2026-0001'),
    ).resolves.toBeNull();
    await expect(store.findById(otherOrganizationId, customer.id)).resolves.toBeNull();

    const listed = await store.list(organizationId);
    expect(listed.map((item) => item.id)).toEqual([customer.id]);
  });

  it('enforces unique public code per organization and allows it across tenants', async () => {
    const organizationId = await newOrganization();
    const otherOrganizationId = await newOrganization();
    const store = required(repository, 'repository');

    await store.save(newCustomer(organizationId, 'CUS-2026-0003'));

    await expect(
      store.save(newCustomer(organizationId, 'CUS-2026-0003')),
    ).rejects.toBeInstanceOf(CustomerInvariantError);

    await expect(
      store.save(newCustomer(otherOrganizationId, 'CUS-2026-0003')),
    ).resolves.toBeUndefined();
  });
});
