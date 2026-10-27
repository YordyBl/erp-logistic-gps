import { describe, expect, it } from 'vitest';

import type { Clock } from '../application/ports/Clock.js';
import type { IdGenerator } from '../application/ports/IdGenerator.js';
import { buildVehiclesModule } from '../composition/composition-root.js';
import { Vehicle } from '../domain/entities/Vehicle.js';
import {
  VehicleInvariantError,
  VehicleNotFoundError,
  VehicleValidationError,
} from '../domain/errors/VehicleError.js';

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
    module: buildVehiclesModule({ clock, idGenerator: sequentialIds() }),
  };
}

function vehicleCommand(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    plate: ' abc-123 ',
    type: ' van ',
    capacityKg: 800,
    ...overrides,
  };
}

describe('Vehicle domain', () => {
  it('normalizes the plate and type, and allows a missing capacity', () => {
    const vehicle = Vehicle.create({
      id: '00000000-0000-4000-8000-000000000001',
      ...vehicleCommand({ capacityKg: undefined }),
      createdAt: CREATED_AT,
    });

    expect(vehicle).toMatchObject({
      plate: 'ABC-123',
      type: 'van',
      capacityKg: null,
      status: 'active',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
  });

  it('rejects an invalid plate, type and capacity', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000001',
      ...vehicleCommand(),
      createdAt: CREATED_AT,
    };

    expect(() => Vehicle.create({ ...base, plate: 'AB' })).toThrow(
      VehicleValidationError,
    );
    expect(() => Vehicle.create({ ...base, type: '' })).toThrow(
      VehicleValidationError,
    );
    expect(() => Vehicle.create({ ...base, capacityKg: -1 })).toThrow(
      VehicleValidationError,
    );
    expect(() =>
      Vehicle.create({ ...base, status: 'archived' as 'active' }),
    ).toThrow(VehicleValidationError);
  });

  it('applies a partial update and can clear the capacity explicitly', () => {
    const vehicle = Vehicle.create({
      id: '00000000-0000-4000-8000-000000000001',
      ...vehicleCommand(),
      createdAt: CREATED_AT,
    });

    const updated = vehicle.withChanges(
      { capacityKg: null, status: 'inactive' },
      LATER_AT,
    );

    expect(updated).toMatchObject({
      id: vehicle.id,
      plate: 'ABC-123',
      type: 'van',
      capacityKg: null,
      status: 'inactive',
      createdAt: CREATED_AT,
      updatedAt: LATER_AT,
    });
    expect(vehicle.capacityKg).toBe(800);
    expect(vehicle.status).toBe('active');
  });

  it('rejects an empty update', () => {
    const vehicle = Vehicle.create({
      id: '00000000-0000-4000-8000-000000000001',
      ...vehicleCommand(),
      createdAt: CREATED_AT,
    });

    expect(() => vehicle.withChanges({}, LATER_AT)).toThrow(
      VehicleValidationError,
    );
  });
});

describe('CreateVehicleUseCase', () => {
  it('creates a vehicle scoped to the organization in the command', async () => {
    const { module } = buildModule();

    const result = await module.createVehicle.execute(vehicleCommand());

    expect(result.vehicle).toMatchObject({
      organizationId: ORGANIZATION_ID,
      plate: 'ABC-123',
      type: 'van',
      capacityKg: 800,
      status: 'active',
      createdAt: CREATED_AT,
    });
  });

  it('rejects a duplicate plate inside one organization only', async () => {
    const { module } = buildModule();

    await module.createVehicle.execute(vehicleCommand());

    await expect(
      module.createVehicle.execute(vehicleCommand()),
    ).rejects.toBeInstanceOf(VehicleInvariantError);

    const otherOrganization = await module.createVehicle.execute(
      vehicleCommand({ organizationId: OTHER_ORGANIZATION_ID }),
    );

    expect(otherOrganization.vehicle.organizationId).toBe(
      OTHER_ORGANIZATION_ID,
    );
  });

  it('converts invalid command input into the module validation error', async () => {
    const { module } = buildModule();

    await expect(
      module.createVehicle.execute(vehicleCommand({ plate: 'AB' })),
    ).rejects.toMatchObject({ code: 'VEHICLE_INVALID_INPUT' });
  });
});

describe('ListVehiclesUseCase', () => {
  it('returns only the requested organization', async () => {
    const { module } = buildModule();

    await module.createVehicle.execute(vehicleCommand());
    await module.createVehicle.execute(vehicleCommand({ plate: 'XYZ-987' }));
    await module.createVehicle.execute(
      vehicleCommand({
        organizationId: OTHER_ORGANIZATION_ID,
        plate: 'QWE-456',
      }),
    );

    const result = await module.listVehicles.execute({
      organizationId: ORGANIZATION_ID,
    });

    expect(result.vehicles).toHaveLength(2);
    expect(
      result.vehicles.every(
        (vehicle) => vehicle.organizationId === ORGANIZATION_ID,
      ),
    ).toBe(true);
  });
});

describe('GetVehicleUseCase', () => {
  it('returns a vehicle of the caller organization and hides other tenants', async () => {
    const { module } = buildModule();
    const created = await module.createVehicle.execute(vehicleCommand());

    const result = await module.getVehicle.execute({
      organizationId: ORGANIZATION_ID,
      vehicleId: created.vehicle.id,
    });
    expect(result.vehicle).toEqual(created.vehicle);

    await expect(
      module.getVehicle.execute({
        organizationId: OTHER_ORGANIZATION_ID,
        vehicleId: created.vehicle.id,
      }),
    ).rejects.toBeInstanceOf(VehicleNotFoundError);
  });

  it('rejects a malformed vehicle id', async () => {
    const { module } = buildModule();

    await expect(
      module.getVehicle.execute({
        organizationId: ORGANIZATION_ID,
        vehicleId: 'not-a-uuid',
      }),
    ).rejects.toMatchObject({ code: 'VEHICLE_INVALID_INPUT' });
  });
});

describe('UpdateVehicleUseCase', () => {
  it('updates only the supplied fields and stamps updatedAt', async () => {
    const { module, clock } = buildModule();
    const created = await module.createVehicle.execute(vehicleCommand());
    clock.current = LATER_AT;

    const result = await module.updateVehicle.execute({
      organizationId: ORGANIZATION_ID,
      vehicleId: created.vehicle.id,
      type: 'truck',
      capacityKg: null,
    });

    expect(result.vehicle).toMatchObject({
      id: created.vehicle.id,
      plate: 'ABC-123',
      type: 'truck',
      capacityKg: null,
      status: 'active',
      createdAt: CREATED_AT,
      updatedAt: LATER_AT,
    });
  });

  it('treats another organization and an unknown id as not found', async () => {
    const { module } = buildModule();
    const created = await module.createVehicle.execute(vehicleCommand());

    await expect(
      module.updateVehicle.execute({
        organizationId: OTHER_ORGANIZATION_ID,
        vehicleId: created.vehicle.id,
        type: 'truck',
      }),
    ).rejects.toBeInstanceOf(VehicleNotFoundError);

    await expect(
      module.updateVehicle.execute({
        organizationId: ORGANIZATION_ID,
        vehicleId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        type: 'truck',
      }),
    ).rejects.toMatchObject({ code: 'VEHICLE_NOT_FOUND' });
  });

  it('rejects an empty update and an attempt to change the plate', async () => {
    const { module } = buildModule();
    const created = await module.createVehicle.execute(vehicleCommand());

    await expect(
      module.updateVehicle.execute({
        organizationId: ORGANIZATION_ID,
        vehicleId: created.vehicle.id,
      }),
    ).rejects.toMatchObject({ code: 'VEHICLE_INVALID_INPUT' });

    await expect(
      module.updateVehicle.execute({
        organizationId: ORGANIZATION_ID,
        vehicleId: created.vehicle.id,
        plate: 'XYZ-987',
      }),
    ).rejects.toMatchObject({ code: 'VEHICLE_INVALID_INPUT' });
  });
});
