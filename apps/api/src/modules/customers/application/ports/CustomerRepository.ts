import type { Customer } from '../../domain/entities/Customer.js';

/**
 * Persistence port for the customer catalog.
 *
 * Every read is tenant-scoped: the organization is part of the key, so a caller
 * cannot resolve a row owned by another organization even if it knows the id.
 * Implementations must keep that filter, including the list ordering.
 */
export interface CustomerRepository {
  save(customer: Customer): Promise<void>;

  findById(organizationId: string, customerId: string): Promise<Customer | null>;

  findByPublicCode(
    organizationId: string,
    publicCode: string,
  ): Promise<Customer | null>;

  /** Customers of one organization, oldest first. */
  list(organizationId: string): Promise<Customer[]>;
}
