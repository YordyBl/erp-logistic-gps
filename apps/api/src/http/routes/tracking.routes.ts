import type { RequestHandler } from 'express';
import { Router } from 'express';

import type { GetRouteTrackUseCase } from '../../modules/delivery-tracking/application/GetRouteTrackUseCase.js';
import { requireOrganizationId } from '../middleware/organization-resolver.js';
import { requireRole } from '../middleware/require-role.js';

/**
 * Control tower reads beside the tracking socket. The organization comes from
 * the verified token; a route of another organization is not found.
 */
export function createTrackingRouter(
  ports: { readonly getRouteTrack: Pick<GetRouteTrackUseCase, 'execute'> },
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.use(authenticate, requireRole('ADMIN', 'DISPATCHER'));
  router.get('/routes/:routeId/track', async (request, response) => {
    const track = await ports.getRouteTrack.execute({
      organizationId: requireOrganizationId(response), routeId: request.params.routeId,
    });
    response.status(200).set('Cache-Control', 'private, no-store').json({ data: track });
  });
  return router;
}
