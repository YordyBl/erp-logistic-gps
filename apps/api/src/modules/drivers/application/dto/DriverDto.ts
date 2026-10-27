import type { Driver, DriverStatus } from '../../domain/entities/Driver.js';

/** Serializable output contract shared by the driver create/list/get/update slices. */
export interface DriverDto {
  readonly id: string;
  readonly organizationId: string;
  readonly fullName: string;
  readonly documentNumber: string;
  readonly phone: string;
  readonly licenseNumber: string;
  readonly status: DriverStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toDriverDto(driver: Driver): DriverDto {
  return {
    id: driver.id,
    organizationId: driver.organizationId,
    fullName: driver.fullName,
    documentNumber: driver.documentNumber,
    phone: driver.phone,
    licenseNumber: driver.licenseNumber,
    status: driver.status,
    createdAt: driver.createdAt,
    updatedAt: driver.updatedAt,
  };
}
