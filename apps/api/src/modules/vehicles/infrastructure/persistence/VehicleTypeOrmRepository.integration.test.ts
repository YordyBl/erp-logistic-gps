import { randomUUID } from 'node:crypto';

import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDataSource } from '../../../../infrastructure/database/data-source.js';
import { Vehicle } from '../../domain/entities/Vehicle.js';
import { VehicleInvariantError } from '../../domain/errors/VehicleError.js';
import { probeVehiclesDatabase } from '../../tests/support/test-database.js';
import { VehicleTypeOrmRepository } from './VehicleTypeOrmRepository.js';

const CREATED_AT = '2026-10-27T15:00:00.000Z';
const UPDATED_AT = '2026-10-27T16:00:00.000Z';

const database = await probeVehiclesDatabase();

if (!database.available) {
  process.stderr.write(
    `[vehicles:integration] Skipping PostgreSQL adapter tests: ${database.reason}. ` +
      'Start the compose PostgreSQL service and set DATABASE_URL to run them.\n',
  );
}

const databaseUrl = database.available ? database.url : null;

describe.skipIf(databaseUrl === null)('vehicles persistence (PostgreSQL)', () => {
  let dataSource: DataSource | undefined;
  let repository: VehicleTypeOrmRepository | undefined;
  const createdOrganizationIds: string[] = [];

  beforeAll(async () => {
    if (databaseUrl === null) {
      return;
    }

    dataSource = createDataSource({ url: databaseUrl });
    await dataSource.initialize();
    repository = new VehicleTypeOrmRepository(dataSource);
  });

  afterAll(async () => {
    if (dataSource === undefined || !dataSource.isInitialized) {
      return;
    }

    for (const organizationId of createdOrganizationIds) {
      await dataSource.query('DELETE FROM vehicles WHERE organization_id = $1', [
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
      [organizationId, 'Vehicle Integration Test'],
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

  function newVehicle(
    organizationId: string,
    plate: string,
    capacityKg: number | null = 800,
  ): Vehicle {
    return Vehicle.create({
      id: randomUUID(),
      organizationId,
      plate,
      type: 'van',
      capacityKg,
      createdAt: CREATED_AT,
    });
  }

  it('round-trips an updated vehicle, including a cleared capacity', async () => {
    const organizationId = await newOrganization();
    const otherOrganizationId = await newOrganization();
    const vehicle = newVehicle(organizationId, 'ABC-123');
    const other = newVehicle(otherOrganizationId, 'XYZ-987');
    const store = required(repository, 'repository');

    await store.save(vehicle);
    await store.save(other);
    await store.save(
      vehicle.withChanges({ capacityKg: null, status: 'inactive' }, UPDATED_AT),
    );

    const loaded = await store.findById(organizationId, vehicle.id);
    expect(loaded).toMatchObject({
      plate: 'ABC-123',
      capacityKg: null,
      status: 'inactive',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });

    await expect(
      store.findByPlate(organizationId, 'ABC-123'),
    ).resolves.toMatchObject({ id: vehicle.id });
    await expect(
      store.findByPlate(otherOrganizationId, 'ABC-123'),
    ).resolves.toBeNull();
    await expect(store.findById(otherOrganizationId, vehicle.id)).resolves.toBeNull();

    const listed = await store.list(organizationId);
    expect(listed.map((item) => item.id)).toEqual([vehicle.id]);
  });

  it('enforces unique plate per organization and allows it across tenants', async () => {
    const organizationId = await newOrganization();
    const otherOrganizationId = await newOrganization();
    const store = required(repository, 'repository');

    await store.save(newVehicle(organizationId, 'QWE-456'));

    await expect(
      store.save(newVehicle(organizationId, 'QWE-456')),
    ).rejects.toBeInstanceOf(VehicleInvariantError);

    await expect(
      store.save(newVehicle(otherOrganizationId, 'QWE-456')),
    ).resolves.toBeUndefined();
  });
});
