import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { createCustomerCommandSchema } from '../../modules/customers/application/use-cases/create-customer/CreateCustomerCommand.js';
import type { CreateCustomerUseCase } from '../../modules/customers/application/use-cases/create-customer/CreateCustomerUseCase.js';
import type { GetCustomerUseCase } from '../../modules/customers/application/use-cases/get-customer/GetCustomerUseCase.js';
import type { ListCustomersPageUseCase } from '../../modules/customers/application/use-cases/list-customers/ListCustomersPageUseCase.js';
import type { ListCustomersUseCase } from '../../modules/customers/application/use-cases/list-customers/ListCustomersUseCase.js';
import {
  CUSTOMER_SORT_FIELDS,
  type CustomerPageCriteria,
} from '../../modules/customers/application/ports/CustomerRepository.js';
import { CUSTOMER_STATUSES } from '../../modules/customers/domain/entities/Customer.js';
import { requireOrganizationId } from '../middleware/organization-resolver.js';
import { requireRole } from '../middleware/require-role.js';
import { csvEnum, csvUuid, pageQueryShape, sortSchema, toPageResponse } from '../pagination.js';
import { parseCustomerOrThrow } from '../validation.js';

/**
 * HTTP adapters for the customer catalog.
 *
 * The organization always comes from the verified JWT request context, never
 * from the body, path or query. All catalog access requires ADMIN or DISPATCHER;
 * DRIVER remains limited to assigned-route operations. There is no delete or update route:
 * customers are catalog records and the ratified CRUD surface stops at create,
 * list and get.
 */
export interface CustomersHttpPorts {
  readonly createCustomer: CreateCustomerUseCase;
  /** Whole catalog; the order import resolves codes with it (not routed here). */
  readonly listCustomers: ListCustomersUseCase;
  readonly listCustomersPage: ListCustomersPageUseCase;
  readonly getCustomer: GetCustomerUseCase;
}

const createCustomerBodySchema = createCustomerCommandSchema.omit({
  organizationId: true,
});

/**
 * Paginated catalog query (`GET /customers`). Unknown parameters are rejected;
 * the default sort is `name:asc` because the catalog is browsed and picked by
 * name. Absent filters stay absent in the criteria (`exactOptionalPropertyTypes`).
 */
const listCustomersPageQuerySchema = z
  .strictObject({
    ...pageQueryShape,
    sort: sortSchema(CUSTOMER_SORT_FIELDS, { field: 'name', direction: 'asc' }),
    status: csvEnum(CUSTOMER_STATUSES).optional(),
    ids: csvUuid().optional(),
  })
  .transform(({ page, pageSize, sort, q, status, ids }): CustomerPageCriteria => ({
    page,
    pageSize,
    sort,
    ...(q === undefined ? {} : { q }),
    ...(status === undefined ? {} : { status }),
    ...(ids === undefined ? {} : { ids }),
  }));

export function createCustomersRouter(
  ports: CustomersHttpPorts,
  authenticate: RequestHandler,
): Router {
  const router = Router();

  router.use(authenticate, requireRole('ADMIN', 'DISPATCHER'));

  router.post('/', async (request, response) => {
    const body = parseCustomerOrThrow(
      createCustomerBodySchema,
      request.body,
      'Create customer request body is invalid',
    );

    const result = await ports.createCustomer.execute({
      organizationId: requireOrganizationId(response),
      ...body,
    });

    response
      .status(201)
      .location(`/api/v1/customers/${result.customer.id}`)
      .json({ data: result.customer });
  });

  router.get('/', async (request, response) => {
    const criteria = parseCustomerOrThrow(
      listCustomersPageQuerySchema,
      request.query,
      'List customers query is invalid',
    );
    const result = await ports.listCustomersPage.execute({
      organizationId: requireOrganizationId(response),
      criteria,
    });

    response.status(200).json(toPageResponse(result, criteria.page, criteria.pageSize));
  });

  router.get('/:customerId', async (request, response) => {
    const result = await ports.getCustomer.execute({
      organizationId: requireOrganizationId(response),
      customerId: request.params.customerId,
    });

    response.status(200).json({ data: result.customer });
  });

  return router;
}
