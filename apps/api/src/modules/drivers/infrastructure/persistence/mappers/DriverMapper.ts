import { Driver, isDriverStatus } from '../../../domain/entities/Driver.js';
import { DriverEntity } from '../entities/DriverEntity.js';

/**
 * Explicit domain ⇄ TypeORM mapping for drivers.
 *
 * A corrupted status in the database fails loudly instead of being coerced into
 * a valid-looking value.
 */
export function toDriverEntity(driver: Driver): DriverEntity {
  const entity = new DriverEntity();

  entity.id = driver.id;
  entity.organizationId = driver.organizationId;
  entity.fullName = driver.fullName;
  entity.documentNumber = driver.documentNumber;
  entity.phone = driver.phone;
  entity.licenseNumber = driver.licenseNumber;
  entity.status = driver.status;
  entity.createdAt = new Date(driver.createdAt);
  entity.updatedAt = new Date(driver.updatedAt);

  return entity;
}

export function toDriverDomain(entity: DriverEntity): Driver {
  if (!isDriverStatus(entity.status)) {
    throw new Error(
      `Persisted driver ${entity.id} has invalid status "${entity.status}"`,
    );
  }

  return Driver.create({
    id: entity.id,
    organizationId: entity.organizationId,
    fullName: entity.fullName,
    documentNumber: entity.documentNumber,
    phone: entity.phone,
    licenseNumber: entity.licenseNumber,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  });
}
