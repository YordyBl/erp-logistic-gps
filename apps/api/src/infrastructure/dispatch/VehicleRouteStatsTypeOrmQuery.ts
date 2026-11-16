import type { DataSource } from 'typeorm';

import { RouteStatsTypeOrmQuery, type RouteStatsScope, type SubjectRouteStats } from './RouteStatsTypeOrmQuery.js';

export {
  DEFAULT_ROUTE_STATS_MONTHS, MAX_ROUTE_STATS_MONTHS, monthKeys, type RouteStatsScope,
} from './RouteStatsTypeOrmQuery.js';

/** Route activity of one vehicle (`GET /vehicles/route-stats`). */
export type VehicleRouteStats = Omit<SubjectRouteStats, 'subjectId'> & { readonly vehicleId: string };

/** {@link RouteStatsTypeOrmQuery} grouped by the route's vehicle. */
export class VehicleRouteStatsTypeOrmQuery {
  private readonly query: RouteStatsTypeOrmQuery;

  constructor(source: Pick<DataSource, 'query'>) {
    this.query = new RouteStatsTypeOrmQuery(source, 'vehicle');
  }

  async getStats(organizationId: string, scope?: RouteStatsScope, now?: Date): Promise<readonly VehicleRouteStats[]> {
    const stats = await this.query.getStats(organizationId, scope, now);
    return stats.map(({ subjectId, ...totals }) => ({ vehicleId: subjectId, ...totals }));
  }
}
