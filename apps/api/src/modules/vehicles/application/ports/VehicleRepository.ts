import type { PageCriteria, PageResult } from '../../../../http/pagination.js';
import type { Vehicle, VehicleStatus } from '../../domain/entities/Vehicle.js';

/** Fields `listPage` may sort by; `id` in the same direction always breaks ties. */
export const VEHICLE_SORT_FIELDS = ['plate', 'createdAt'] as const;
export type VehicleSortField = (typeof VEHICLE_SORT_FIELDS)[number];

/**
 * One page of a tenant's vehicles. Filters are optional and combine with AND;
 * `q` matches (case-insensitive substring) the plate and the type.
 */
export interface VehiclePageCriteria extends PageCriteria<VehicleSortField> {
  readonly status?: readonly VehicleStatus[];
  readonly ids?: readonly string[];
}

/**
 * Persistence port for the vehicle catalog.
 *
 * Every read is tenant-scoped: the organization is part of the key.
 */
export interface VehicleRepository {
  save(vehicle: Vehicle): Promise<void>;

  findById(organizationId: string, vehicleId: string): Promise<Vehicle | null>;

  findByPlate(organizationId: string, plate: string): Promise<Vehicle | null>;

  /**
   * Every vehicle of one organization, oldest first. Kept unpaginated for the
   * selectors and plate lookups of the dispatch screens (`GET /vehicles/options`).
   */
  list(organizationId: string): Promise<Vehicle[]>;

  /**
   * One page of the tenant's vehicles with the filtered total and
   * `counts.status`, which applies every filter except `status` and lists
   * every status (0 when nothing matches).
   */
  listPage(organizationId: string, criteria: VehiclePageCriteria): Promise<PageResult<Vehicle>>;
}
