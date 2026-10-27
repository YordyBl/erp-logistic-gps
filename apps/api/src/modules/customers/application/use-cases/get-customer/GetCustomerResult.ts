import type { CustomerDto } from '../../dto/CustomerDto.js';

export interface GetCustomerResult {
  readonly customer: CustomerDto;
}
