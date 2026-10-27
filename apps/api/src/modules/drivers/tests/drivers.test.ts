import { describe, expect, it } from 'vitest';

import type { Clock } from '../application/ports/Clock.js';
import type { IdGenerator } from '../application/ports/IdGenerator.js';
import { buildDriversModule } from '../composition/composition-root.js';
import { Driver } from '../domain/entities/Driver.js';
import {
  DriverInvariantError,
  DriverNotFoundError,
  DriverValidationError,
} from '../domain/errors/DriverError.js';

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
    module: buildDriversModule({ clock, idGenerator: sequentialIds() }),
  };
}

function driverCommand(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    fullName: '  Luis Quispe  ',
    documentNumber: ' dni-12345678 ',
    phone: ' +51 911 222 333 ',
    licenseNumber: ' q-987654 ',
    ...overrides,
  };
}

describe('Driver domain', () => {
  it('normalizes identity document, license and text fields', () => {
    const driver = Driver.create({
      id: '00000000-0000-4000-8000-000000000001',
      ...driverCommand(),
      createdAt: CREATED_AT,
    });

    expect(driver).toMatchObject({
      fullName: 'Luis Quispe',
      documentNumber: 'DNI-12345678',
      phone: '+51 911 222 333',
      licenseNumber: 'Q-987654',
      status: 'active',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
  });

  it('rejects an invalid document number, phone and status', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000001',
      ...driverCommand(),
      createdAt: CREATED_AT,
    };

    expect(() => Driver.create({ ...base, documentNumber: '' })).toThrow(
      DriverValidationError,
    );
    expect(() => Driver.create({ ...base, phone: 'abc' })).toThrow(
      DriverValidationError,
    );
    expect(() =>
      Driver.create({ ...base, status: 'archived' as 'active' }),
    ).toThrow(DriverValidationError);
  });

  it('applies a partial update without mutating the original instance', () => {
    const driver = Driver.create({
      id: '00000000-0000-4000-8000-000000000001',
      ...driverCommand(),
      createdAt: CREATED_AT,
    });

    const updated = driver.withChanges(
      { fullName: 'Luis Quispe Rojas', status: 'inactive' },
      LATER_AT,
    );

    expect(updated).toMatchObject({
      id: driver.id,
      fullName: 'Luis Quispe Rojas',
      documentNumber: 'DNI-12345678',
      phone: '+51 911 222 333',
      status: 'inactive',
      createdAt: CREATED_AT,
      updatedAt: LATER_AT,
    });
    expect(driver.fullName).toBe('Luis Quispe');
    expect(driver.updatedAt).toBe(CREATED_AT);
  });

  it('rejects an empty update', () => {
    const driver = Driver.create({
      id: '00000000-0000-4000-8000-000000000001',
      ...driverCommand(),
      createdAt: CREATED_AT,
    });

    expect(() => driver.withChanges({}, LATER_AT)).toThrow(DriverValidationError);
  });
});

describe('CreateDriverUseCase', () => {
  it('creates a driver scoped to the organization in the command', async () => {
    const { module } = buildModule();

    const result = await module.createDriver.execute(driverCommand());

    expect(result.driver).toMatchObject({
      organizationId: ORGANIZATION_ID,
      fullName: 'Luis Quispe',
      documentNumber: 'DNI-12345678',
      status: 'active',
      createdAt: CREATED_AT,
    });
  });

  it('rejects a duplicate document number inside one organization only', async () => {
    const { module } = buildModule();

    await module.createDriver.execute(driverCommand());

    await expect(
      module.createDriver.execute(driverCommand()),
    ).rejects.toBeInstanceOf(DriverInvariantError);

    const otherOrganization = await module.createDriver.execute(
      driverCommand({ organizationId: OTHER_ORGANIZATION_ID }),
    );

    expect(otherOrganization.driver.organizationId).toBe(OTHER_ORGANIZATION_ID);
  });

  it('converts invalid command input into the module validation error', async () => {
    const { module } = buildModule();

    await expect(
      module.createDriver.execute(driverCommand({ documentNumber: '' })),
    ).rejects.toMatchObject({ code: 'DRIVER_INVALID_INPUT' });
  });
});

describe('ListDriversUseCase', () => {
  it('returns only the requested organization', async () => {
    const { module } = buildModule();

    await module.createDriver.execute(driverCommand());
    await module.createDriver.execute(
      driverCommand({ documentNumber: 'DNI-87654321' }),
    );
    await module.createDriver.execute(
      driverCommand({
        organizationId: OTHER_ORGANIZATION_ID,
        documentNumber: 'DNI-11111111',
      }),
    );

    const result = await module.listDrivers.execute({
      organizationId: ORGANIZATION_ID,
    });

    expect(result.drivers).toHaveLength(2);
    expect(
      result.drivers.every((driver) => driver.organizationId === ORGANIZATION_ID),
    ).toBe(true);
  });
});

describe('GetDriverUseCase', () => {
  it('returns a driver of the caller organization and hides other tenants', async () => {
    const { module } = buildModule();
    const created = await module.createDriver.execute(driverCommand());

    const result = await module.getDriver.execute({
      organizationId: ORGANIZATION_ID,
      driverId: created.driver.id,
    });
    expect(result.driver).toEqual(created.driver);

    await expect(
      module.getDriver.execute({
        organizationId: OTHER_ORGANIZATION_ID,
        driverId: created.driver.id,
      }),
    ).rejects.toBeInstanceOf(DriverNotFoundError);
  });

  it('rejects a malformed driver id', async () => {
    const { module } = buildModule();

    await expect(
      module.getDriver.execute({
        organizationId: ORGANIZATION_ID,
        driverId: 'not-a-uuid',
      }),
    ).rejects.toMatchObject({ code: 'DRIVER_INVALID_INPUT' });
  });
});

describe('UpdateDriverUseCase', () => {
  it('updates only the supplied fields and stamps updatedAt', async () => {
    const { module, clock } = buildModule();
    const created = await module.createDriver.execute(driverCommand());
    clock.current = LATER_AT;

    const result = await module.updateDriver.execute({
      organizationId: ORGANIZATION_ID,
      driverId: created.driver.id,
      fullName: 'Luis Quispe Rojas',
      status: 'inactive',
    });

    expect(result.driver).toMatchObject({
      id: created.driver.id,
      documentNumber: 'DNI-12345678',
      phone: '+51 911 222 333',
      fullName: 'Luis Quispe Rojas',
      status: 'inactive',
      createdAt: CREATED_AT,
      updatedAt: LATER_AT,
    });
  });

  it('treats another organization and an unknown id as not found', async () => {
    const { module } = buildModule();
    const created = await module.createDriver.execute(driverCommand());

    await expect(
      module.updateDriver.execute({
        organizationId: OTHER_ORGANIZATION_ID,
        driverId: created.driver.id,
        fullName: 'Cross Tenant',
      }),
    ).rejects.toBeInstanceOf(DriverNotFoundError);

    await expect(
      module.updateDriver.execute({
        organizationId: ORGANIZATION_ID,
        driverId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        fullName: 'Ghost',
      }),
    ).rejects.toMatchObject({ code: 'DRIVER_NOT_FOUND' });
  });

  it('rejects an empty update and an attempt to change the document number', async () => {
    const { module } = buildModule();
    const created = await module.createDriver.execute(driverCommand());

    await expect(
      module.updateDriver.execute({
        organizationId: ORGANIZATION_ID,
        driverId: created.driver.id,
      }),
    ).rejects.toMatchObject({ code: 'DRIVER_INVALID_INPUT' });

    await expect(
      module.updateDriver.execute({
        organizationId: ORGANIZATION_ID,
        driverId: created.driver.id,
        documentNumber: 'DNI-00000000',
      }),
    ).rejects.toMatchObject({ code: 'DRIVER_INVALID_INPUT' });
  });
});
