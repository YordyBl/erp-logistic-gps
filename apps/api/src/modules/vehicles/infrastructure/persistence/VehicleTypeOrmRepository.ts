import type { DataSource } from 'typeorm';

import type { VehicleRepository } from '../../application/ports/VehicleRepository.js';
import type { Vehicle } from '../../domain/entities/Vehicle.js';
import { vehiclePlateAlreadyInUse } from '../../domain/errors/VehicleError.js';
import { VehicleEntity } from './entities/VehicleEntity.js';
import { toVehicleDomain, toVehicleEntity } from './mappers/VehicleMapper.js';
import { readPostgresDriverError, toError } from './postgres-error.js';

/**
 * PostgreSQL adapter for the {@link VehicleRepository} port.
 *
 * Every read filters by `organizationId` in the same query as the id or plate,
 * so a caller cannot resolve another tenant row.
 */
export class VehicleTypeOrmRepository implements VehicleRepository {
  constructor(private readonly dataSource: DataSource) {}

  async save(vehicle: Vehicle): Promise<void> {
    try {
      await this.dataSource
        .getRepository(VehicleEntity)
        .save(toVehicleEntity(vehicle));
    } catch (error) {
      throw translateVehiclePersistenceError(error, vehicle);
    }
  }

  async findById(
    organizationId: string,
    vehicleId: string,
  ): Promise<Vehicle | null> {
    const entity = await this.dataSource
      .getRepository(VehicleEntity)
      .findOne({ where: { id: vehicleId, organizationId } });

    return entity === null ? null : toVehicleDomain(entity);
  }

  async findByPlate(
    organizationId: string,
    plate: string,
  ): Promise<Vehicle | null> {
    const entity = await this.dataSource
      .getRepository(VehicleEntity)
      .findOne({ where: { organizationId, plate } });

    return entity === null ? null : toVehicleDomain(entity);
  }

  async list(organizationId: string): Promise<Vehicle[]> {
    const entities = await this.dataSource.getRepository(VehicleEntity).find({
      where: { organizationId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    return entities.map(toVehicleDomain);
  }
}

function translateVehiclePersistenceError(
  error: unknown,
  vehicle: Vehicle,
): Error {
  const driverError = readPostgresDriverError(error);

  if (
    driverError?.code === '23505' &&
    driverError.constraint === 'uq_vehicles_organization_plate'
  ) {
    return vehiclePlateAlreadyInUse(vehicle.plate, vehicle.organizationId);
  }

  return toError(error);
}
