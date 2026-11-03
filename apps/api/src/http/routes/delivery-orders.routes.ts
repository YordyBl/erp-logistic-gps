import express, { type RequestHandler, Router } from 'express';
import { z } from 'zod';

import type { DeliveryOrderRepository } from '../../modules/delivery-orders/application/ports/DeliveryOrderRepository.js';
import type { GetCustomerUseCase } from '../../modules/customers/application/use-cases/get-customer/GetCustomerUseCase.js';
import type { ListCustomersUseCase } from '../../modules/customers/application/use-cases/list-customers/ListCustomersUseCase.js';
import type { CancelDeliveryOrderUseCase } from '../../modules/delivery-orders/application/use-cases/cancel-delivery-order/CancelDeliveryOrderUseCase.js';
import { createDeliveryOrderCommandSchema } from '../../modules/delivery-orders/application/use-cases/create-delivery-order/CreateDeliveryOrderCommand.js';
import { GoogleMapsLinkResolver } from '../../modules/delivery-routes/infrastructure/GoogleMapsLinkResolver.js';
import type { CreateDeliveryOrderUseCase } from '../../modules/delivery-orders/application/use-cases/create-delivery-order/CreateDeliveryOrderUseCase.js';
import { getDeliveryOrderQuerySchema } from '../../modules/delivery-orders/application/use-cases/get-delivery-order/GetDeliveryOrderQuery.js';
import type { GetDeliveryOrderUseCase } from '../../modules/delivery-orders/application/use-cases/get-delivery-order/GetDeliveryOrderUseCase.js';
import type { ListDeliveryOrdersUseCase } from '../../modules/delivery-orders/application/use-cases/list-delivery-orders/ListDeliveryOrdersUseCase.js';
import { editOrderBodySchema, type EditDeliveryOrderUseCase } from '../../modules/delivery-orders/application/use-cases/edit-delivery-order/EditDeliveryOrderUseCase.js';
import { PUBLIC_CODE_PATTERN } from '../../modules/delivery-orders/domain/entities/DeliveryOrder.js';
import { HttpError } from '../errors.js';
import { requireOrganizationId } from '../middleware/organization-resolver.js';
import { requireRole } from '../middleware/require-role.js';
import { AUTH_TOKEN_MISSING_MESSAGE } from '../middleware/authenticate.js';
import { getAuthenticatedUser } from '../request-context.js';
import { parseOrThrow } from '../validation.js';
import {
  createDeliveryOrderImportTemplate,
  DeliveryOrderImportFileError,
  importDeliveryOrderRows,
  parseDeliveryOrderImportFile,
} from '../delivery-order-import.js';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const IMPORT_CONTENT_TYPES = ['text/csv', XLSX_CONTENT_TYPE];
const IMPORT_BODY_LIMIT = '5mb';

/**
 * HTTP adapters for the `delivery-orders` module.
 *
 * The organization always comes from the verified JWT claims in the request
 * context and is never read from the header, body, path or query. Only ADMIN and
 * DISPATCHER may access the general order catalog; DRIVER uses assigned-route
 * execution endpoints. The body is
 * parsed with the application command schema; the `organizationId` field is
 * removed from the accepted body shape so a caller cannot inject a tenant.
 */
export interface DeliveryOrdersHttpPorts {
  readonly createDeliveryOrder: CreateDeliveryOrderUseCase;
  readonly getDeliveryOrder: GetDeliveryOrderUseCase;
  readonly listDeliveryOrders: ListDeliveryOrdersUseCase;
  readonly editDeliveryOrder: EditDeliveryOrderUseCase;
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
  getCustomer: GetCustomerUseCase,
  listCustomers: ListCustomersUseCase,
): Router {
  const router = Router();
  const mapLinkResolver = new GoogleMapsLinkResolver();

  router.use(authenticate, requireRole('ADMIN', 'DISPATCHER'));

  router.post('/resolve-map-link', async (request, response) => {
    const body = parseOrThrow(z.strictObject({ url: z.string().trim().url().max(2048) }),
      request.body, 'Google Maps link request is invalid');
    try {
      const coordinates = await mapLinkResolver.resolve(body.url);
      response.status(200).json({ data: coordinates });
    } catch {
      throw new HttpError(422, 'GOOGLE_MAPS_LINK_UNRESOLVED', 'The Google Maps link could not be resolved to coordinates.');
    }
  });

  router.post('/', async (request, response) => {
    const body = parseOrThrow(
      createOrderBodySchema,
      request.body,
      'Create delivery order request body is invalid',
    );
    const organizationId = requireOrganizationId(response);
    const { customer } = await getCustomer.execute({ organizationId, customerId: body.customerId });
    if (customer.status !== 'active') {
      throw new HttpError(409, 'CUSTOMER_INACTIVE', 'Inactive customers cannot receive new delivery orders');
    }

    const result = await ports.createDeliveryOrder.execute({
      organizationId,
      ...body,
    });

    response
      .status(201)
      .location(`/api/v1/delivery-orders/${result.order.id}`)
      .json({ data: result.order });
  });

  router.post(
    '/import',
    express.raw({ type: IMPORT_CONTENT_TYPES, limit: IMPORT_BODY_LIMIT }),
    async (request, response) => {
      const contentType = request.is(IMPORT_CONTENT_TYPES);
      if (contentType === false || contentType === null) {
        throw new HttpError(415, 'DELIVERY_ORDER_IMPORT_UNSUPPORTED_TYPE', 'Upload a CSV or XLSX file.');
      }
      if (!Buffer.isBuffer(request.body)) {
        throw new HttpError(400, 'DELIVERY_ORDER_IMPORT_INVALID_FILE', 'Import file body is missing.');
      }

      const format = contentType === 'text/csv' ? 'csv' : 'xlsx';
      let rows;
      try {
        rows = await parseDeliveryOrderImportFile(request.body, format);
      } catch (error) {
        if (error instanceof DeliveryOrderImportFileError) {
          throw new HttpError(400, error.code, error.message);
        }
        throw error;
      }

      const organizationId = requireOrganizationId(response);
      const { customers } = await listCustomers.execute({ organizationId });
      const result = await importDeliveryOrderRows({
        organizationId,
        rows,
        customers,
        createOrder: ports.createDeliveryOrder,
      });
      response.status(200).json({ data: result });
    },
  );

  router.get('/import/template', async (_request, response) => {
    const template = await createDeliveryOrderImportTemplate();
    response
      .status(200)
      .type(XLSX_CONTENT_TYPE)
      .set('Content-Disposition', 'attachment; filename="delivery-orders-template.xlsx"')
      .send(template);
  });

  router.get('/', async (request, response) => {
    const organizationId = requireOrganizationId(response);
    if (Object.keys(request.query).length === 0) {
      const result = await ports.listDeliveryOrders.execute({ organizationId });
      response.status(200).json({ data: result.orders });
      return;
    }
    const query = parseOrThrow(
      publicCodeQuerySchema,
      request.query,
      'List delivery orders query is invalid',
    );

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

  router.patch('/:orderId', async (request, response) => {
    const changes = parseOrThrow(editOrderBodySchema, request.body,
      'Edit delivery order request body is invalid');
    const result = await ports.editDeliveryOrder.execute({
      organizationId: requireOrganizationId(response),
      orderId: request.params.orderId,
      changes,
    });
    response.status(200).json({ data: result.order });
  });

  router.post('/:orderId/cancel', async (request, response) => {
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
