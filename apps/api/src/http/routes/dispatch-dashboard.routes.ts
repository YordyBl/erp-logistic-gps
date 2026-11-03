import type { RequestHandler } from 'express';
import { Router } from 'express';

import type { DispatchDashboardSummary } from '../../infrastructure/dispatch/DispatchDashboardTypeOrmQuery.js';
import { requireRole } from '../middleware/require-role.js';
import { requireOrganizationId } from '../middleware/organization-resolver.js';

export interface DispatchDashboardQuery {
  getSummary(organizationId: string): Promise<DispatchDashboardSummary>;
}

export function createDispatchDashboardRouter(
  query: DispatchDashboardQuery,
  authenticate: RequestHandler,
): Router {
  const router = Router();

  router.get('/', authenticate, requireRole('ADMIN', 'DISPATCHER'), async (_request, response) => {
    const summary = await query.getSummary(requireOrganizationId(response));
    response.json({ data: summary });
  });

  return router;
}
