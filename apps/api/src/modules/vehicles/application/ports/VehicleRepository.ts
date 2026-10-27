import type { Vehicle } from '../../domain/entities/Vehicle.js';

/**
 * Persistence port for the vehicle catalog.
 *
 * Every read is tenant-scoped: the organization is part of the key.
 */
export interface VehicleRepository {
  save(vehicle: Vehicle): Promise<void>;

  findById(organizationId: string, vehicleId: string): Promise<Vehicle | null>;

  findByPlate(organizationId: string, plate: string): Promise<Vehicle | null>;

  /** Vehicles of one organization, oldest first. */
  list(organizationId: string): Promise<Vehicle[]>;
}
