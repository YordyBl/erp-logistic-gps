import type { DriverDto } from '../../dto/DriverDto.js';

export interface ListDriversResult {
  readonly drivers: readonly DriverDto[];
}
