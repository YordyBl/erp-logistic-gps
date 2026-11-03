import type { RequestHandler } from 'express';
import { Router } from 'express';

import { planRouteBodySchema, type PlanRouteUseCase } from '../../modules/delivery-routes/application/use-cases/plan-route/PlanRouteUseCase.js';
import type { GetRouteUseCase } from '../../modules/delivery-routes/application/use-cases/get-route/GetRouteUseCase.js';
import { reassignRouteBodySchema, type ReassignRouteUseCase } from '../../modules/delivery-routes/application/use-cases/reassign-route/ReassignRouteUseCase.js';
import type { ExecuteDriverRouteUseCase } from '../../modules/delivery-routes/application/use-cases/execute-driver-route/ExecuteDriverRouteUseCase.js';
import { z } from 'zod';
import { requireOrganizationId } from '../middleware/organization-resolver.js';
import { requireRole } from '../middleware/require-role.js';
import { getAuthenticatedUser } from '../request-context.js';
import { parseOrThrow } from '../validation.js';

export function createDeliveryRoutesRouter(
  ports: {
    readonly planRoute: PlanRouteUseCase;
    readonly listRoutes: { execute(input: unknown): Promise<{ routes: readonly unknown[] }> };
    readonly getRoute: GetRouteUseCase;
    readonly reassignRoute: ReassignRouteUseCase;
    readonly executeDriverRoute: ExecuteDriverRouteUseCase;
  },
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/', requireRole('ADMIN', 'DISPATCHER'), async (_request, response) => {
    const result = await ports.listRoutes.execute({ organizationId: requireOrganizationId(response) });
    response.status(200).json({ data: result.routes });
  });
  router.post('/', requireRole('ADMIN', 'DISPATCHER'), async (request, response) => {
    const body = parseOrThrow(planRouteBodySchema, request.body, 'Plan route request body is invalid');
    const organizationId = requireOrganizationId(response);
    const user = getAuthenticatedUser(response);
    // Authentication and role middleware have already established the actor.
    if (user === undefined) throw new Error('Authenticated actor is required');
    const result = await ports.planRoute.execute({ organizationId, actorUserId: user.id, ...body });
    response.status(201).location(`/api/v1/delivery-routes/${result.route.id}`)
      .json({ data: result.route });
  });
  router.get('/mine', requireRole('DRIVER'), async (_request, response) => {
    const user = getAuthenticatedUser(response);
    if (user === undefined) throw new Error('Authenticated actor is required');
    const result = await ports.executeDriverRoute.mine({
      organizationId: requireOrganizationId(response), actorUserId: user.id,
    });
    response.status(200).json({ data: result.route });
  });
  router.post('/:routeId/start', requireRole('DRIVER'), async (request, response) => {
    parseOrThrow(z.strictObject({}), request.body ?? {}, 'Start route request body is invalid');
    const user = getAuthenticatedUser(response);
    if (user === undefined) throw new Error('Authenticated actor is required');
    const result = await ports.executeDriverRoute.start({
      organizationId: requireOrganizationId(response), routeId: request.params.routeId,
      actorUserId: user.id,
    });
    response.status(200).json({ data: result.route });
  });
  router.post('/:routeId/complete', requireRole('DRIVER'), async (request, response) => {
    parseOrThrow(z.strictObject({}), request.body ?? {}, 'Complete route request body is invalid');
    const user = getAuthenticatedUser(response);
    if (user === undefined) throw new Error('Authenticated actor is required');
    const result = await ports.executeDriverRoute.complete({
      organizationId: requireOrganizationId(response), routeId: request.params.routeId,
      actorUserId: user.id,
    });
    response.status(200).json({ data: result.route });
  });
  router.post('/orders/:orderId/confirm', requireRole('DRIVER'), async (request, response) => {
    const body = parseOrThrow(z.strictObject({
      evidenceIds: z.array(z.uuid()).min(1).max(2),
      receiverName: z.string().trim().min(1).max(120).nullable().default(null),
      notes: z.string().trim().min(1).max(500).nullable().default(null),
    }), request.body, 'Confirm delivery request body is invalid');
    const user = getAuthenticatedUser(response);
    if (user === undefined) throw new Error('Authenticated actor is required');
    const result = await ports.executeDriverRoute.confirmDelivery({
      organizationId: requireOrganizationId(response), orderId: request.params.orderId,
      actorUserId: user.id, ...body,
    });
    response.status(200).json({ data: result });
  });
  router.post('/orders/:orderId/incidents', requireRole('DRIVER'), async (request, response) => {
    const body = parseOrThrow(z.strictObject({
      category: z.enum(['recipient_absent', 'incorrect_address', 'delivery_refused',
        'damaged_package', 'access_restricted', 'vehicle_issue', 'other']),
      description: z.string().trim().min(3).max(1000),
      evidenceIds: z.array(z.uuid()).min(1).max(2),
    }), request.body, 'Report delivery incident request body is invalid');
    const user = getAuthenticatedUser(response);
    if (user === undefined) throw new Error('Authenticated actor is required');
    const result = await ports.executeDriverRoute.reportDeliveryIncident({
      organizationId: requireOrganizationId(response), orderId: request.params.orderId,
      actorUserId: user.id, ...body,
    });
    response.status(201).json({ data: result.incident });
  });
  router.get('/:routeId', requireRole('ADMIN', 'DISPATCHER'), async (request, response) => {
    const result = await ports.getRoute.execute({
      organizationId: requireOrganizationId(response), routeId: request.params.routeId,
    });
    response.status(200).json({ data: result.route });
  });
  router.patch('/:routeId', requireRole('ADMIN', 'DISPATCHER'), async (request, response) => {
    const changes = parseOrThrow(reassignRouteBodySchema, request.body,
      'Reassign route request body is invalid');
    const result = await ports.reassignRoute.execute({
      organizationId: requireOrganizationId(response),
      routeId: request.params.routeId,
      ...changes,
    });
    response.status(200).json({ data: result.route });
  });
  return router;
}
