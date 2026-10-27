import type { DeliveryOrderDto } from '../../dto/DeliveryOrderDto.js';

export interface CreateDeliveryOrderResult {
  readonly order: DeliveryOrderDto;
}
