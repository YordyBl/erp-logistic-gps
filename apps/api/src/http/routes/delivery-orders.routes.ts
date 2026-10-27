import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import type { DeliveryOrderRepository } from '../../modules/delivery-orders/application/ports/DeliveryOrderRepository.js';
import type { CancelDeliveryOrderUseCase } from '../../modules/delivery-orders/application/use-cases/cancel-delivery-order/CancelDeliveryOrderUseCase.js';
import { createDeliveryOrderCommandSchema } from '../../modules/delivery-orders/application/use-cases/create-delivery-order/CreateDeliveryOrderCommand.js';
import type { CreateDeliveryOrderUseCase } from '../../modules/delivery-orders/application/use-cases/create-delivery-order/CreateDeliveryOrderUseCase.js';
import { getDeliveryOrderQuerySchema } from '../../modules/delivery-orders/application/use-cases/get-delivery-order/GetDeliveryOrderQuery.js';
import type { GetDeliveryOrderUseCase } from '../../modules/delivery-orders/application/use-cases/get-delivery-order/GetDeliveryOrderUseCase.js';
import { PUBLIC_CODE_PATTERN } from '../../modules/delivery-orders/domain/entities/DeliveryOrder.js';
import { HttpError } from '../errors.js';
import { requireOrganizationId } from '../middleware/organization-resolver.js';
import { requireRole } from '../middleware/require-role.js';
import { AUTH_TOKEN_MISSING_MESSAGE } from '../middleware/authenticate.js';
import { getAuthenticatedUser } from '../request-context.js';
import { parseOrThrow } from '../validation.js';

/**
 * HTTP adapters for the `delivery-orders` module.
 *
 * The organization always comes from the verified JWT claims in the request
 * context and is never read from the header, body, path or query. The body is
 * parsed with the application command schema; the `organizationId` field is
 * removed from the accepted body shape so a caller cannot inject a tenant.
 */
export interface DeliveryOrdersHttpPorts {
  readonly createDeliveryOrder: CreateDeliveryOrderUseCase;
  readonly getDeliveryOrder: GetDeliveryOrderUseCase;
  readonly cancelDeliveryOrder: CancelDeliveryOrderUseCase;
  readonly repository: DeliveryOrderRepository;
}

const createOrderBodySchema = createDeliveryOrderCommandSchema.omit({
  organizationId: true,
});

const publicCodeQuerySchema = z.strictObject({
  publicCode: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(
      z
        .string()
        .min(3)
        .max(32)
        .regex(
          PUBLIC_CODE_PATTERN,
          'publicCode must contain letters, digits and separating hyphens',
        ),
    ),
});

export function createDeliveryOrdersRouter(
  ports: DeliveryOrdersHttpPorts,
  authenticate: RequestHandler,
): Router {
  const router = Router();

  router.use(authenticate);

  router.post('/', async (request, response) => {
    const body = parseOrThrow(
      createOrderBodySchema,
      request.body,
      'Create delivery order request body is invalid',
    );
    const organizationId = requireOrganizationId(response);

    const result = await ports.createDeliveryOrder.execute({
      organizationId,
      ...body,
    });

    response
      .status(201)
      .location(`/api/v1/delivery-orders/${result.order.id}`)
      .json({ data: result.order });
  });

  router.get('/', async (request, response) => {
    const query = parseOrThrow(
      publicCodeQuerySchema,
      request.query,
      'List delivery orders query is invalid',
    );
    const organizationId = requireOrganizationId(response);

    // Public codes are unique per organization, so the tenant-scoped repository
    // lookup resolves the internal id. The read use case then applies the
    // regular ownership check and output contract; adding a second query here
    // keeps one authorization path instead of duplicating it in HTTP.
    const order = await ports.repository.findByPublicCode(
      organizationId,
      query.publicCode,
    );

    if (order === null) {
      throw new HttpError(
        404,
        'DELIVERY_ORDER_NOT_FOUND',
        `Delivery order ${query.publicCode} was not found`,
      );
    }

    const result = await ports.getDeliveryOrder.execute({
      organizationId,
      orderId: order.id,
    });

    response.status(200).json({ data: result.order });
  });

  router.get('/:orderId', async (request, response) => {
    const query = parseOrThrow(
      getDeliveryOrderQuerySchema,
      {
        organizationId: requireOrganizationId(response),
        orderId: request.params.orderId,
      },
      'Get delivery order query is invalid',
    );

    const result = await ports.getDeliveryOrder.execute(query);

    response.status(200).json({ data: result.order });
  });

  router.post('/:orderId/cancel', requireRole('ADMIN', 'DISPATCHER'), async (request, response) => {
    parseOrThrow(z.strictObject({}), request.body ?? {}, 'Cancel delivery order request body is invalid');
    const user = getAuthenticatedUser(response);
    if (user === undefined) throw new HttpError(401, 'AUTH_TOKEN_MISSING', AUTH_TOKEN_MISSING_MESSAGE);
    const result = await ports.cancelDeliveryOrder.execute({
      organizationId: requireOrganizationId(response),
      orderId: request.params.orderId,
      actorUserId: user.id,
    });
    response.status(200).json({ data: result.order });
  });

  router.get('/:orderId/history', async (request, response) => {
    const query = parseOrThrow(
      getDeliveryOrderQuerySchema,
      { organizationId: requireOrganizationId(response), orderId: request.params.orderId },
      'Get delivery order history query is invalid',
    );
    await ports.getDeliveryOrder.execute(query);
    const history = await ports.repository.findStatusHistory(query.organizationId, query.orderId);
    response.status(200).json({ data: history });
  });

  return router;
}
