import { describe, expect, it } from 'vitest';

import type { Clock } from '../application/ports/Clock.js';
import type { IdGenerator } from '../application/ports/IdGenerator.js';
import { buildCustomersModule } from '../composition/composition-root.js';
import { Customer } from '../domain/entities/Customer.js';
import {
  CustomerInvariantError,
  CustomerNotFoundError,
  CustomerValidationError,
} from '../domain/errors/CustomerError.js';

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_AT = '2026-10-27T15:00:00.000Z';
const LATER_AT = '2026-10-27T16:00:00.000Z';

class MutableClock implements Clock {
  current = CREATED_AT;

  now(): string {
    return this.current;
  }
}

function sequentialIds(): IdGenerator {
  let next = 0;

  return {
    nextId: () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`,
  };
}

function buildModule() {
  const clock = new MutableClock();

  return {
    clock,
    module: buildCustomersModule({ clock, idGenerator: sequentialIds() }),
  };
}

function customerCommand(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    publicCode: 'cus-2026-0001',
    name: '  Distribuidora Lima SAC  ',
    contactName: ' Ana Torres ',
    contactEmail: ' Contact@Distribuidora.PE ',
    contactPhone: ' +51 987 654 321 ',
    ...overrides,
  };
}

describe('Customer domain', () => {
  it('normalizes public code, text fields and contact email', () => {
    const customer = Customer.create({
      id: '00000000-0000-4000-8000-000000000001',
      ...customerCommand(),
      createdAt: CREATED_AT,
    });

    expect(customer).toMatchObject({
      publicCode: 'CUS-2026-0001',
      name: 'Distribuidora Lima SAC',
      contactName: 'Ana Torres',
      contactEmail: 'contact@distribuidora.pe',
      contactPhone: '+51 987 654 321',
      status: 'active',
      createdAt: CREATED_AT,
    });
  });

  it('rejects an invalid public code, contact email and status', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000001',
      ...customerCommand(),
      createdAt: CREATED_AT,
    };

    expect(() => Customer.create({ ...base, publicCode: 'AB' })).toThrow(
      CustomerValidationError,
    );
    expect(() => Customer.create({ ...base, contactEmail: 'not-an-email' })).toThrow(
      CustomerValidationError,
    );
    expect(() =>
      Customer.create({ ...base, status: 'archived' as 'active' }),
    ).toThrow(CustomerValidationError);
  });
});

describe('CreateCustomerUseCase', () => {
  it('creates a customer scoped to the organization in the command', async () => {
    const { module } = buildModule();

    const result = await module.createCustomer.execute(customerCommand());

    expect(result.customer).toMatchObject({
      organizationId: ORGANIZATION_ID,
      publicCode: 'CUS-2026-0001',
      contactEmail: 'contact@distribuidora.pe',
      status: 'active',
      createdAt: CREATED_AT,
    });
    await expect(
      module.repository.findById(ORGANIZATION_ID, result.customer.id),
    ).resolves.toMatchObject({ id: result.customer.id });
  });

  it('rejects a duplicate public code inside one organization only', async () => {
    const { module } = buildModule();

    await module.createCustomer.execute(customerCommand());

    await expect(
      module.createCustomer.execute(customerCommand()),
    ).rejects.toBeInstanceOf(CustomerInvariantError);

    const otherOrganization = await module.createCustomer.execute(
      customerCommand({ organizationId: OTHER_ORGANIZATION_ID }),
    );

    expect(otherOrganization.customer.organizationId).toBe(
      OTHER_ORGANIZATION_ID,
    );
  });

  it('converts invalid command input into the module validation error', async () => {
    const { module } = buildModule();

    await expect(
      module.createCustomer.execute(customerCommand({ name: '' })),
    ).rejects.toMatchObject({
      code: 'CUSTOMER_INVALID_INPUT',
      details: {
        issues: expect.arrayContaining([expect.objectContaining({ path: 'name' })]),
      },
    });
  });
});

describe('ListCustomersUseCase', () => {
  it('returns only the requested organization, oldest first', async () => {
    const { module, clock } = buildModule();

    const first = await module.createCustomer.execute(customerCommand());
    clock.current = LATER_AT;
    const second = await module.createCustomer.execute(
      customerCommand({ publicCode: 'CUS-2026-0002' }),
    );
    await module.createCustomer.execute(
      customerCommand({
        organizationId: OTHER_ORGANIZATION_ID,
        publicCode: 'CUS-2026-0003',
      }),
    );

    const result = await module.listCustomers.execute({
      organizationId: ORGANIZATION_ID,
    });

    expect(result.customers.map((customer) => customer.id)).toEqual([
      first.customer.id,
      second.customer.id,
    ]);
  });
});

describe('GetCustomerUseCase', () => {
  it('returns a customer of the caller organization', async () => {
    const { module } = buildModule();
    const created = await module.createCustomer.execute(customerCommand());

    const result = await module.getCustomer.execute({
      organizationId: ORGANIZATION_ID,
      customerId: created.customer.id,
    });

    expect(result.customer).toEqual(created.customer);
  });

  it('treats another organization and an unknown id as not found', async () => {
    const { module } = buildModule();
    const created = await module.createCustomer.execute(customerCommand());

    await expect(
      module.getCustomer.execute({
        organizationId: OTHER_ORGANIZATION_ID,
        customerId: created.customer.id,
      }),
    ).rejects.toBeInstanceOf(CustomerNotFoundError);

    await expect(
      module.getCustomer.execute({
        organizationId: ORGANIZATION_ID,
        customerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    ).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('rejects a malformed customer id before querying storage', async () => {
    const { module } = buildModule();

    await expect(
      module.getCustomer.execute({
        organizationId: ORGANIZATION_ID,
        customerId: 'not-a-uuid',
      }),
    ).rejects.toMatchObject({
      code: 'CUSTOMER_INVALID_INPUT',
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ path: 'customerId' }),
        ]),
      },
    });
  });
});
