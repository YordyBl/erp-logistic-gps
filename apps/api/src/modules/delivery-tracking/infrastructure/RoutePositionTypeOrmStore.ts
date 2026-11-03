import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import type { PositionSource, RoutePositionContext, RoutePosition } from '../application/ports/PositionProvider.js';

export interface RoutePositionStore {
  findActiveRoutes(): Promise<readonly RoutePositionContext[]>;
  findLatestForRoutes(organizationId: string, routeIds: readonly string[]): Promise<readonly RoutePosition[]>;
  record(position: RoutePosition): Promise<boolean>;
  pruneReceivedBefore(cutoff: string): Promise<number>;
}

interface ActiveRouteRow {
  organizationId: string;
  routeId: string;
  driverId: string;
  driverUserId: string;
  simulatedCompletionEnabled: boolean;
  startedAt: Date;
  originAddressLine: string | null;
  originLatitude: string | number | null;
  originLongitude: string | number | null;
  latitude: string | number | null;
  longitude: string | number | null;
  sequence: number;
}

interface LatestPositionRow extends Omit<RoutePosition, 'latitude' | 'longitude' | 'accuracyMeters' |
  'speedMetersPerSecond' | 'recordedAt' | 'receivedAt'> {
  latitude: string | number;
  longitude: string | number;
  accuracyMeters: string | number;
  speedMetersPerSecond: string | number;
  recordedAt: Date | string;
  receivedAt: Date | string;
  source: PositionSource;
}

export class RoutePositionTypeOrmStore implements RoutePositionStore {
  constructor(private readonly dataSource: DataSource) {}

  async findActiveRoutes(): Promise<readonly RoutePositionContext[]> {
    const rows = await this.dataSource.query<ActiveRouteRow[]>(`
      SELECT r.organization_id AS "organizationId", r.id AS "routeId",
        r.driver_id AS "driverId", accounts.user_id AS "driverUserId",
        r.simulated_completion_enabled AS "simulatedCompletionEnabled", r.started_at AS "startedAt",
        r.origin_address_line AS "originAddressLine", r.origin_latitude AS "originLatitude",
        r.origin_longitude AS "originLongitude",
        s.latitude AS "latitude", s.longitude AS "longitude", s.sequence AS "sequence"
      FROM delivery_routes r
      JOIN driver_accounts accounts ON accounts.organization_id=r.organization_id
        AND accounts.driver_id=r.driver_id
      JOIN delivery_stops s ON s.organization_id=r.organization_id AND s.route_id=r.id
      WHERE r.status='in_progress' AND r.started_at IS NOT NULL
        AND r.simulated_completion_enabled=true
        AND EXISTS (SELECT 1 FROM delivery_attempts a
          WHERE a.organization_id=r.organization_id AND a.route_id=r.id
            AND a.driver_id=r.driver_id AND a.status='in_progress')
      ORDER BY r.organization_id, r.id, s.sequence`);

    const grouped = new Map<string, {
      organizationId: string;
      routeId: string;
      driverId: string;
      driverUserId: string;
      simulatedCompletionEnabled: boolean;
      startedAt: string;
      origin?: { addressLine: string; latitude: number; longitude: number };
      stops: { latitude: number | null; longitude: number | null }[];
    }>();
    for (const row of rows) {
      const key = `${row.organizationId}:${row.routeId}`;
      let route = grouped.get(key);
      if (route === undefined) {
        route = {
          organizationId: row.organizationId,
          routeId: row.routeId,
          driverId: row.driverId,
          driverUserId: row.driverUserId,
          simulatedCompletionEnabled: row.simulatedCompletionEnabled,
          startedAt: row.startedAt.toISOString(),
          stops: [],
        };
        if (row.originAddressLine !== null && row.originLatitude !== null && row.originLongitude !== null) {
          route.origin = { addressLine: row.originAddressLine,
            latitude: Number(row.originLatitude), longitude: Number(row.originLongitude) };
        }
        grouped.set(key, route);
      }
      route.stops.push({
        latitude: row.latitude === null ? null : Number(row.latitude),
        longitude: row.longitude === null ? null : Number(row.longitude),
      });
    }
    return [...grouped.values()].map((route) => ({
      ...route,
      stops: route.stops,
      ...(route.origin === undefined ? {} : { origin: route.origin }),
    }));
  }

  async findLatestForRoutes(
    organizationId: string,
    routeIds: readonly string[],
  ): Promise<readonly RoutePosition[]> {
    if (routeIds.length === 0) return [];
    const rows = await this.dataSource.query<LatestPositionRow[]>(`
      SELECT organization_id AS "organizationId", route_id AS "routeId",
        driver_id AS "driverId", latitude, longitude, accuracy_meters AS "accuracyMeters",
        speed_meters_per_second AS "speedMetersPerSecond", source,
        recorded_at AS "recordedAt", received_at AS "receivedAt"
      FROM (
        SELECT DISTINCT ON (route_id) organization_id, route_id, driver_id, latitude,
          longitude, accuracy_meters, speed_meters_per_second, source, recorded_at, received_at
        FROM route_positions
        WHERE organization_id=$1 AND route_id = ANY($2::uuid[])
        ORDER BY route_id, received_at DESC, recorded_at DESC
      ) latest
      ORDER BY received_at DESC`, [organizationId, routeIds]);
    return rows.map((row) => ({
      ...row,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      accuracyMeters: Number(row.accuracyMeters),
      speedMetersPerSecond: Number(row.speedMetersPerSecond),
      recordedAt: new Date(row.recordedAt).toISOString(),
      receivedAt: new Date(row.receivedAt).toISOString(),
    }));
  }

  async record(position: RoutePosition): Promise<boolean> {
    const result = await this.dataSource.query<{ id: string }[]>(`
      INSERT INTO route_positions (
        id, organization_id, route_id, driver_id, latitude, longitude,
        accuracy_meters, speed_meters_per_second, source, recorded_at, received_at
      )
      SELECT $1, $2, r.id, r.driver_id, $5, $6, $7, $8, $9, $10, $11
      FROM delivery_routes r
      WHERE r.organization_id=$2 AND r.id=$3 AND r.driver_id=$4
        AND r.status='in_progress'
        AND EXISTS (SELECT 1 FROM delivery_attempts a
          WHERE a.organization_id=r.organization_id AND a.route_id=r.id
            AND a.driver_id=r.driver_id AND a.status='in_progress')
      RETURNING id`, [randomUUID(), position.organizationId, position.routeId,
      position.driverId, position.latitude, position.longitude, position.accuracyMeters,
      position.speedMetersPerSecond, position.source, position.recordedAt, position.receivedAt]);
    return result.length === 1;
  }

  async pruneReceivedBefore(cutoff: string): Promise<number> {
    const result = await this.dataSource.query<{ count: string }[]>(`
      WITH removed AS (
        DELETE FROM route_positions WHERE received_at < $1 RETURNING 1
      )
      SELECT count(*)::text AS count FROM removed`, [cutoff]);
    return Number(result[0]?.count ?? '0');
  }
}
