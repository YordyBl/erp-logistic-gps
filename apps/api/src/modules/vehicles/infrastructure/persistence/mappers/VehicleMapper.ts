import { isVehicleStatus, Vehicle } from '../../../domain/entities/Vehicle.js';
import { VehicleEntity } from '../entities/VehicleEntity.js';

/**
 * Explicit domain ⇄ TypeORM mapping for vehicles.
 *
 * PostgreSQL returns `numeric` as a string, so the mapper converts it and lets
 * the entity re-validate the result. A corrupted status fails loudly.
 */
export function toVehicleEntity(vehicle: Vehicle): VehicleEntity {
  const entity = new VehicleEntity();

  entity.id = vehicle.id;
  entity.organizationId = vehicle.organizationId;
  entity.plate = vehicle.plate;
  entity.type = vehicle.type;
  entity.capacityKg =
    vehicle.capacityKg === null ? null : String(vehicle.capacityKg);
  entity.status = vehicle.status;
  entity.createdAt = new Date(vehicle.createdAt);
  entity.updatedAt = new Date(vehicle.updatedAt);

  return entity;
}

export function toVehicleDomain(entity: VehicleEntity): Vehicle {
  if (!isVehicleStatus(entity.status)) {
    throw new Error(
      `Persisted vehicle ${entity.id} has invalid status "${entity.status}"`,
    );
  }

  return Vehicle.create({
    id: entity.id,
    organizationId: entity.organizationId,
    plate: entity.plate,
    type: entity.type,
    capacityKg:
      entity.capacityKg === null ? null : Number(entity.capacityKg),
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  });
}
