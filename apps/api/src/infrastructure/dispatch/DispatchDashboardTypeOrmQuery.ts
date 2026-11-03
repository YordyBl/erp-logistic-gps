import type { DataSource } from 'typeorm';

import {
  DELIVERY_ORDER_STATUSES,
  type DeliveryOrderStatus,
} from '../../modules/delivery-orders/domain/policies/DeliveryOrderStatusPolicy.js';

export interface DispatchDashboardSummary {
  readonly ordersAwaitingPlanning: number;
  readonly routesInProgress: number;
  readonly deliveriesToday: number;
  readonly incidentsToday: number;
  readonly orderStatusCounts: Readonly<Record<DeliveryOrderStatus, number>>;
  readonly recentOrders: readonly {
    readonly id: string;
    readonly publicCode: string;
    readonly status: DeliveryOrderStatus;
    readonly createdAt: string;
  }[];
  readonly recentIncidents: readonly {
    readonly id: string;
    readonly orderId: string;
    readonly publicCode: string;
    readonly category: string;
    readonly description: string;
    readonly occurredAt: string;
  }[];
  readonly activeRoutes: readonly {
    readonly id: string;
    readonly publicCode: string;
    readonly plannedDate: string;
    readonly lastPosition: {
      readonly latitude: number;
      readonly longitude: number;
      readonly receivedAt: string;
    } | null;
  }[];
}

interface DashboardOrderStatusRow {
  readonly status: DeliveryOrderStatus;
  readonly count: string | number;
}

interface CountRow {
  readonly count: string | number;
}

interface RecentOrderRow {
  readonly id: string;
  readonly public_code: string;
  readonly status: DeliveryOrderStatus;
  readonly created_at: Date | string;
}

interface RecentIncidentRow {
  readonly id: string;
  readonly order_id: string;
  readonly public_code: string;
  readonly category: string;
  readonly description: string;
  readonly occurred_at: Date | string;
}

interface ActiveRouteRow {
  readonly id: string;
  readonly public_code: string;
  readonly planned_date: string;
  readonly latitude: string | number | null;
  readonly longitude: string | number | null;
  readonly received_at: Date | string | null;
}

/** Cross-module read model for the tenant-scoped dispatcher dashboard. */
export class DispatchDashboardTypeOrmQuery {
  constructor(private readonly source: Pick<DataSource, 'query'>) {}

  async getSummary(organizationId: string, now = new Date()): Promise<DispatchDashboardSummary> {
    const dayBounds = limaDayBounds(now);
    const [orderRows, routeRows, deliveryRows, incidentRows, recentOrderRows, recentIncidentRows, activeRouteRows] = await Promise.all([
      this.source.query<DashboardOrderStatusRow[]>(
        `SELECT status, COUNT(*)::integer AS count
         FROM delivery_orders WHERE organization_id=$1 GROUP BY status`, [organizationId]),
      this.source.query<CountRow[]>(
        `SELECT COUNT(*)::integer AS count FROM delivery_routes
         WHERE organization_id=$1 AND status='in_progress'`, [organizationId]),
      this.source.query<CountRow[]>(
        `SELECT COUNT(*)::integer AS count FROM delivery_attempts
         WHERE organization_id=$1 AND status='delivered' AND completed_at >= $2 AND completed_at < $3`,
        [organizationId, ...dayBounds]),
      this.source.query<CountRow[]>(
        `SELECT COUNT(*)::integer AS count FROM delivery_incidents
         WHERE organization_id=$1 AND occurred_at >= $2 AND occurred_at < $3`,
        [organizationId, ...dayBounds]),
      this.source.query<RecentOrderRow[]>(
        `SELECT id, public_code, status, created_at FROM delivery_orders
         WHERE organization_id=$1 ORDER BY created_at DESC, id DESC LIMIT 5`, [organizationId]),
      this.source.query<RecentIncidentRow[]>(
        `SELECT incidents.id, incidents.order_id, orders.public_code, incidents.category,
                incidents.description, incidents.occurred_at
         FROM delivery_incidents incidents
         INNER JOIN delivery_orders orders
           ON orders.organization_id=incidents.organization_id AND orders.id=incidents.order_id
         WHERE incidents.organization_id=$1
         ORDER BY incidents.occurred_at DESC, incidents.id DESC LIMIT 5`, [organizationId]),
      this.source.query<ActiveRouteRow[]>(
        `SELECT routes.id, routes.public_code, routes.planned_date,
                latest.latitude, latest.longitude, latest.received_at
         FROM delivery_routes routes
         LEFT JOIN LATERAL (
           SELECT latitude, longitude, received_at FROM route_positions
           WHERE organization_id=routes.organization_id AND route_id=routes.id
           ORDER BY received_at DESC, recorded_at DESC LIMIT 1
         ) latest ON true
         WHERE routes.organization_id=$1 AND routes.status='in_progress'
         ORDER BY routes.started_at DESC, routes.id DESC LIMIT 5`, [organizationId]),
    ]);

    const orderStatusCounts = Object.fromEntries(
      DELIVERY_ORDER_STATUSES.map((status) => [status, 0]),
    ) as Record<DeliveryOrderStatus, number>;
    for (const row of orderRows) orderStatusCounts[row.status] = Number(row.count);

    return {
      ordersAwaitingPlanning: orderStatusCounts.created + orderStatusCounts.returned,
      routesInProgress: Number(routeRows[0]?.count ?? 0),
      deliveriesToday: Number(deliveryRows[0]?.count ?? 0),
      incidentsToday: Number(incidentRows[0]?.count ?? 0),
      orderStatusCounts,
      recentOrders: recentOrderRows.map((row) => ({
        id: row.id, publicCode: row.public_code, status: row.status, createdAt: isoString(row.created_at),
      })),
      recentIncidents: recentIncidentRows.map((row) => ({
        id: row.id, orderId: row.order_id, publicCode: row.public_code, category: row.category,
        description: row.description, occurredAt: isoString(row.occurred_at),
      })),
      activeRoutes: activeRouteRows.map((row) => ({
        id: row.id,
        publicCode: row.public_code,
        plannedDate: row.planned_date,
        lastPosition: row.latitude === null || row.longitude === null || row.received_at === null ? null : {
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          receivedAt: isoString(row.received_at),
        },
      })),
    };
  }
}

function limaDayBounds(now: Date): readonly [Date, Date] {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  // Lima is UTC-05:00 year-round; pass one fixed range to every daily aggregate.
  const start = new Date(Date.UTC(year, month - 1, day, 5));
  return [start, new Date(start.getTime() + 24 * 60 * 60 * 1_000)];
}

function isoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
