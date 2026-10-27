import type { Driver } from '../../domain/entities/Driver.js';

/**
 * Persistence port for the driver catalog.
 *
 * Every read is tenant-scoped: the organization is part of the key. The update
 * path re-reads through {@link findByDocumentNumber} only for the create
 * uniqueness check; updates go through `findById` first.
 */
export interface DriverRepository {
  save(driver: Driver): Promise<void>;

  findById(organizationId: string, driverId: string): Promise<Driver | null>;

  findByDocumentNumber(
    organizationId: string,
    documentNumber: string,
  ): Promise<Driver | null>;

  /** Drivers of one organization, oldest first. */
  list(organizationId: string): Promise<Driver[]>;
}
