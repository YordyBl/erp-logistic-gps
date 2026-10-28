import type { DeliveryOrderDto } from '../../../delivery-orders/application/dto/DeliveryOrderDto.js';
import type { PlannedStop } from './RoutePlanningStore.js';

export interface DriverRouteView {
  readonly id: string;
  readonly publicCode: string;
  readonly plannedDate: string;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly status: 'planned' | 'in_progress';
  readonly startedAt: string | null;
  readonly stops: readonly (Omit<PlannedStop, 'orderIds'> & {
    readonly orders: readonly DeliveryOrderDto[];
  })[];
}

/** The production implementation checks the account binding within the same transaction as start. */
export interface DriverRouteExecutionStore {
  mine(organizationId: string, actorUserId: string): Promise<DriverRouteView>;
  start(organizationId: string, routeId: string, actorUserId: string,
    occurredAt: string): Promise<DriverRouteView>;
}
