import type { DataSource } from 'typeorm';

import { RouteStatsTypeOrmQuery, type RouteStatsScope, type SubjectRouteStats } from './RouteStatsTypeOrmQuery.js';

/** Trips of one driver (`GET /drivers/route-stats`): the routes assigned to them. */
export type DriverRouteStats = Omit<SubjectRouteStats, 'subjectId'> & { readonly driverId: string };

/** {@link RouteStatsTypeOrmQuery} grouped by the route's driver. */
export class DriverRouteStatsTypeOrmQuery {
  private readonly query: RouteStatsTypeOrmQuery;

  constructor(source: Pick<DataSource, 'query'>) {
    this.query = new RouteStatsTypeOrmQuery(source, 'driver');
  }

  async getStats(organizationId: string, scope?: RouteStatsScope, now?: Date): Promise<readonly DriverRouteStats[]> {
    const stats = await this.query.getStats(organizationId, scope, now);
    return stats.map(({ subjectId, ...totals }) => ({ driverId: subjectId, ...totals }));
  }
}
