import type { CustomerDto } from '../../dto/CustomerDto.js';

export interface CreateCustomerResult {
  readonly customer: CustomerDto;
}
