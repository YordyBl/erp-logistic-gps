import type { Customer, CustomerStatus } from '../../domain/entities/Customer.js';

/** Serializable output contract shared by the customer create/list/get slices. */
export interface CustomerDto {
  readonly id: string;
  readonly organizationId: string;
  readonly publicCode: string;
  readonly name: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly status: CustomerStatus;
  readonly createdAt: string;
}

export function toCustomerDto(customer: Customer): CustomerDto {
  return {
    id: customer.id,
    organizationId: customer.organizationId,
    publicCode: customer.publicCode,
    name: customer.name,
    contactName: customer.contactName,
    contactEmail: customer.contactEmail,
    contactPhone: customer.contactPhone,
    status: customer.status,
    createdAt: customer.createdAt,
  };
}
