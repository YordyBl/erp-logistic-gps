import type { DeliveryOrderDto } from '../../../delivery-orders/application/dto/DeliveryOrderDto.js';
import type { PlannedStop } from './RoutePlanningStore.js';

export interface DriverRouteView {
  readonly id: string;
  readonly publicCode: string;
  readonly plannedDate: string;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly status: 'planned' | 'in_progress' | 'completed';
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly stops: readonly (Omit<PlannedStop, 'orderIds'> & {
    readonly orders: readonly DeliveryOrderDto[];
  })[];
}

/** The production implementation checks the account binding within the same transaction as start. */
export interface DriverRouteExecutionStore {
  mine(organizationId: string, actorUserId: string): Promise<DriverRouteView>;
  start(organizationId: string, routeId: string, actorUserId: string,
    occurredAt: string): Promise<DriverRouteView>;
  confirmDelivery?(organizationId: string, orderId: string, actorUserId: string,
    input: { readonly evidenceIds: readonly string[]; readonly receiverName: string | null;
      readonly notes: string | null }, occurredAt: string): Promise<void>;
  reportDeliveryIncident?(organizationId: string, orderId: string, actorUserId: string,
    input: { readonly category: string; readonly description: string;
      readonly evidenceIds: readonly string[] }, occurredAt: string): Promise<{ incident: {
        readonly id: string; readonly category: string; readonly description: string;
        readonly occurredAt: string;
      } }>;
  complete?(organizationId: string, routeId: string, actorUserId: string,
    occurredAt: string): Promise<DriverRouteView>;
  completeSimulated?(organizationId: string, routeId: string, driverId: string,
    actorUserId: string, occurredAt: string): Promise<DriverRouteView>;
}
