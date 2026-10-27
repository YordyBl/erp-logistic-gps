import type { CustomerDto } from '../../dto/CustomerDto.js';

export interface ListCustomersResult {
  readonly customers: readonly CustomerDto[];
}
