import type { VehicleDto } from '../../dto/VehicleDto.js';

export interface ListVehiclesResult {
  readonly vehicles: readonly VehicleDto[];
}
