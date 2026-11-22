import type { PageCriteria, PageResult } from '../../../../http/pagination.js';
import type { Customer, CustomerStatus } from '../../domain/entities/Customer.js';

/** Fields `listPage` may sort by; `id` in the same direction always breaks ties. */
export const CUSTOMER_SORT_FIELDS = ['name', 'createdAt'] as const;
export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

/**
 * One page of a tenant's customers. Filters are optional and combine with AND;
 * `q` matches (case-insensitive substring) the name, public code and the
 * contact name, email and phone.
 */
export interface CustomerPageCriteria extends PageCriteria<CustomerSortField> {
  readonly status?: readonly CustomerStatus[];
  readonly ids?: readonly string[];
}

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

  /**
   * Every customer of one organization, oldest first. Kept unpaginated for the
   * order import, which resolves customer codes against the whole catalog.
   */
  list(organizationId: string): Promise<Customer[]>;

  /**
   * One page of the tenant's customers with the filtered total and
   * `counts.status`, which applies every filter except `status` and lists
   * every status (0 when nothing matches).
   */
  listPage(
    organizationId: string,
    criteria: CustomerPageCriteria,
  ): Promise<PageResult<Customer>>;
}
