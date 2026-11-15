import type { DataSource } from 'typeorm';

import { LIMA_TIME_ZONE } from '../../config/config.js';
import type { DeliveryOrderStatus } from '../../modules/delivery-orders/domain/policies/DeliveryOrderStatusPolicy.js';

export type TrackingRouteStatus = 'planned' | 'in_progress' | 'completed';

export interface TrackingSnapshotStop {
  readonly id: string;
  readonly sequence: number;
  readonly addressLine: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly orderIds: readonly string[];
}

export interface TrackingSnapshotRoute {
  readonly id: string;
  readonly publicCode: string;
  readonly plannedDate: string;
  readonly status: TrackingRouteStatus;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly stops: readonly TrackingSnapshotStop[];
}

export interface TrackingSnapshotOrder {
  readonly id: string;
  readonly publicCode: string;
  readonly status: DeliveryOrderStatus;
}

export interface TrackingSnapshotData {
  readonly routes: readonly TrackingSnapshotRoute[];
  readonly orders: readonly TrackingSnapshotOrder[];
}

interface RouteRow {
  readonly id: string;
  readonly public_code: string;
  readonly planned_date: string;
  readonly status: TrackingRouteStatus;
  readonly driver_id: string;
  readonly vehicle_id: string;
}

export interface StopRow {
  readonly id: string;
  readonly route_id: string;
  readonly sequence: number;
  readonly address_line: string;
  readonly latitude: string | number | null;
  readonly longitude: string | number | null;
}

export interface StopLinkRow {
  readonly route_id: string;
  readonly stop_id: string;
  readonly order_id: string;
}

interface OrderRow {
  readonly id: string;
  readonly public_code: string;
  readonly status: DeliveryOrderStatus;
}

/**
 * Read model for the control tower socket: only the operations that are live
 * (in progress, or planned for today onwards in Lima). A fixed number of
 * queries, independent of how many routes and stops the snapshot holds.
 */
export class TrackingSnapshotTypeOrmQuery {
  constructor(private readonly source: Pick<DataSource, 'query'>) {}

  async load(organizationId: string, today: string): Promise<TrackingSnapshotData> {
    const routeRows = await this.source.query<RouteRow[]>(
      `SELECT id, public_code, planned_date::text AS planned_date, status, driver_id, vehicle_id
       FROM delivery_routes
       WHERE organization_id=$1
         AND (status='in_progress' OR (status='planned' AND planned_date >= $2))
       ORDER BY planned_date ASC, created_at ASC, id ASC`, [organizationId, today]);
    if (routeRows.length === 0) return { routes: [], orders: [] };

    const routeIds = routeRows.map((row) => row.id);
    const { stopsByRoute, orderIds } = await loadRouteStops(this.source, organizationId, routeIds);
    const orderRows = orderIds.length === 0 ? [] : await this.source.query<OrderRow[]>(
      `SELECT id, public_code, status FROM delivery_orders
       WHERE organization_id=$1 AND id = ANY($2::uuid[])`, [organizationId, orderIds]);

    return {
      routes: routeRows.map((row) => ({
        id: row.id,
        publicCode: row.public_code,
        plannedDate: plainDate(row.planned_date),
        status: row.status,
        driverId: row.driver_id,
        vehicleId: row.vehicle_id,
        stops: stopsByRoute.get(row.id) ?? [],
      })),
      orders: orderRows.map((row) => ({ id: row.id, publicCode: row.public_code, status: row.status })),
    };
  }
}

/**
 * Stops and their order links for many routes in two queries, grouped by
 * route in sequence order with each stop's orders in link position order.
 */
export async function loadRouteStops(
  source: Pick<DataSource, 'query'>, organizationId: string, routeIds: readonly string[],
): Promise<{
  readonly stopsByRoute: ReadonlyMap<string, readonly TrackingSnapshotStop[]>;
  readonly orderIds: readonly string[];
}> {
  if (routeIds.length === 0) return { stopsByRoute: new Map(), orderIds: [] };
  const [stopRows, linkRows] = await Promise.all([
    source.query<StopRow[]>(
      `SELECT id, route_id, sequence, address_line, latitude, longitude
       FROM delivery_stops
       WHERE organization_id=$1 AND route_id = ANY($2::uuid[])
       ORDER BY route_id ASC, sequence ASC`, [organizationId, routeIds]),
    source.query<StopLinkRow[]>(
      `SELECT route_id, stop_id, order_id
       FROM delivery_stop_orders
       WHERE organization_id=$1 AND route_id = ANY($2::uuid[])
       ORDER BY position ASC`, [organizationId, routeIds]),
  ]);
  const ordersByStop = new Map<string, string[]>();
  const orderIds = new Set<string>();
  for (const link of linkRows) {
    const list = ordersByStop.get(link.stop_id);
    if (list === undefined) ordersByStop.set(link.stop_id, [link.order_id]);
    else list.push(link.order_id);
    orderIds.add(link.order_id);
  }
  const stopsByRoute = new Map<string, TrackingSnapshotStop[]>();
  for (const row of stopRows) {
    const stop: TrackingSnapshotStop = {
      id: row.id,
      sequence: Number(row.sequence),
      addressLine: row.address_line,
      latitude: row.latitude === null ? null : Number(row.latitude),
      longitude: row.longitude === null ? null : Number(row.longitude),
      orderIds: ordersByStop.get(row.id) ?? [],
    };
    const list = stopsByRoute.get(row.route_id);
    if (list === undefined) stopsByRoute.set(row.route_id, [stop]);
    else list.push(stop);
  }
  return { stopsByRoute, orderIds: [...orderIds] };
}

/** Calendar date (YYYY-MM-DD) in Lima for the given instant. */
export function limaDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LIMA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function plainDate(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
