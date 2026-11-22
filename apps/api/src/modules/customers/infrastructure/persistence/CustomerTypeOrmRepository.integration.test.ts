import { randomUUID } from 'node:crypto';

import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDataSource } from '../../../../infrastructure/database/data-source.js';
import type { CustomerPageCriteria } from '../../application/ports/CustomerRepository.js';
import { InMemoryCustomerRepository } from '../../composition/composition-root.js';
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

  it('pages, filters, searches and counts like the in-memory adapter', async () => {
    const ownerId = await newOrganization();
    const foreignId = await newOrganization();
    const store = required(repository, 'repository');
    const memory = new InMemoryCustomerRepository();
    const variant = (organizationId: string, publicCode: string, overrides: {
      readonly name: string; readonly contactName: string; readonly contactEmail: string;
      readonly contactPhone: string; readonly createdAt: string; readonly status?: 'active' | 'inactive';
    }) => Customer.create({ id: randomUUID(), organizationId, publicCode, ...overrides });
    const customers = [
      variant(ownerId, 'PAGE-DELTA', {
        name: 'Delta Courier', contactName: 'Diego Paz', contactEmail: 'ops@delta.pe',
        contactPhone: '+51 911 111 111', createdAt: '2026-10-27T15:00:00.000Z',
      }),
      variant(ownerId, 'PAGE-ALPHA', {
        name: 'Alpha Retail', contactName: 'Ana Quispe', contactEmail: 'ventas@alpha.pe',
        contactPhone: '+51 922 222 222', createdAt: '2026-10-27T16:00:00.000Z',
      }),
      variant(ownerId, 'PAGE-CHARLIE', {
        name: 'Charlie Foods', contactName: 'Carla Ríos', contactEmail: 'compras@charlie_foods.pe',
        contactPhone: '+51 933 333 333', createdAt: '2026-10-27T16:00:00.000Z', status: 'inactive',
      }),
      variant(ownerId, 'PAGE-BRAVO', {
        name: 'Bravo 100% Market', contactName: 'Bruno Díaz', contactEmail: 'hola@bravo.pe',
        contactPhone: '+51 944 444 444', createdAt: '2026-10-27T17:00:00.000Z',
      }),
      variant(foreignId, 'PAGE-ALPHA', {
        name: 'Alpha Foránea', contactName: 'Ana Otra', contactEmail: 'ventas@alpha.pe',
        contactPhone: '+51 955 555 555', createdAt: '2026-10-27T18:00:00.000Z',
      }),
    ];
    for (const customer of customers) {
      await store.save(customer);
      await memory.save(customer);
    }

    const base = { page: 1, pageSize: 20, sort: { field: 'name', direction: 'asc' } } as const;
    const scenarios: CustomerPageCriteria[] = [
      base,
      { ...base, page: 2, pageSize: 3 },
      { ...base, sort: { field: 'name', direction: 'desc' } },
      { ...base, sort: { field: 'createdAt', direction: 'asc' } },
      { ...base, sort: { field: 'createdAt', direction: 'desc' } },
      { ...base, status: ['inactive'] },
      { ...base, status: ['active', 'inactive'] },
      { ...base, q: 'ALPHA' },
      { ...base, q: 'page-bravo' },
      { ...base, q: 'diego' },
      { ...base, q: '933 333' },
      { ...base, q: '100%' },
      { ...base, q: '_' },
      { ...base, q: 'alpha', status: ['inactive'] },
      { ...base, ids: [customers[0]!.id, customers[4]!.id] },
      { ...base, page: 9 },
    ];
    for (const criteria of scenarios) {
      const [stored, inMemory] = await Promise.all([
        store.listPage(ownerId, criteria),
        memory.listPage(ownerId, criteria),
      ]);
      expect(stored, JSON.stringify(criteria)).toEqual(inMemory);
    }

    const firstPage = await store.listPage(ownerId, { ...base, pageSize: 2 });
    expect(firstPage.items.map((customer) => customer.publicCode)).toEqual(['PAGE-ALPHA', 'PAGE-BRAVO']);
    expect(firstPage.total).toBe(4);
    expect(firstPage.counts).toEqual({ status: { active: 3, inactive: 1 } });
    // createdAt desc, then id desc between the two 16:00 customers.
    const newest = await store.listPage(ownerId, { ...base, sort: { field: 'createdAt', direction: 'desc' } });
    const tied = [customers[1]!.id, customers[2]!.id].sort().reverse();
    expect(newest.items.map((customer) => customer.id).slice(1, 3)).toEqual(tied);
    const searched = await store.listPage(ownerId, { ...base, q: 'alpha', status: ['inactive'] });
    expect(searched.items).toEqual([]);
    expect(searched.counts).toEqual({ status: { active: 1, inactive: 0 } });
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
