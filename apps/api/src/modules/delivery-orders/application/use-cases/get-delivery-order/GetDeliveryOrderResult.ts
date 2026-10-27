import type { DeliveryOrderDto } from '../../dto/DeliveryOrderDto.js';

export interface GetDeliveryOrderResult {
  readonly order: DeliveryOrderDto;
}
