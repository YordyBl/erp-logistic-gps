import type { Vehicle, VehicleStatus } from '../../domain/entities/Vehicle.js';

/** Serializable output contract shared by the vehicle create/list/get/update slices. */
export interface VehicleDto {
  readonly id: string;
  readonly organizationId: string;
  readonly plate: string;
  readonly type: string;
  readonly capacityKg: number | null;
  readonly status: VehicleStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toVehicleDto(vehicle: Vehicle): VehicleDto {
  return {
    id: vehicle.id,
    organizationId: vehicle.organizationId,
    plate: vehicle.plate,
    type: vehicle.type,
    capacityKg: vehicle.capacityKg,
    status: vehicle.status,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  };
}
