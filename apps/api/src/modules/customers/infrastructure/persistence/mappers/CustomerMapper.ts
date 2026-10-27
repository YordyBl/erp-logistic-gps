import { isCustomerStatus, Customer } from '../../../domain/entities/Customer.js';
import { CustomerEntity } from '../entities/CustomerEntity.js';

/**
 * Explicit domain ⇄ TypeORM mapping for customers.
 *
 * A corrupted status in the database fails loudly instead of being coerced into
 * a valid-looking value.
 */
export function toCustomerEntity(customer: Customer): CustomerEntity {
  const entity = new CustomerEntity();

  entity.id = customer.id;
  entity.organizationId = customer.organizationId;
  entity.publicCode = customer.publicCode;
  entity.name = customer.name;
  entity.contactName = customer.contactName;
  entity.contactEmail = customer.contactEmail;
  entity.contactPhone = customer.contactPhone;
  entity.status = customer.status;
  entity.createdAt = new Date(customer.createdAt);

  return entity;
}

export function toCustomerDomain(entity: CustomerEntity): Customer {
  if (!isCustomerStatus(entity.status)) {
    throw new Error(
      `Persisted customer ${entity.id} has invalid status "${entity.status}"`,
    );
  }

  return Customer.create({
    id: entity.id,
    organizationId: entity.organizationId,
    publicCode: entity.publicCode,
    name: entity.name,
    contactName: entity.contactName,
    contactEmail: entity.contactEmail,
    contactPhone: entity.contactPhone,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
  });
}
