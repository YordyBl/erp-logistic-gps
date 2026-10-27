import type { RequestHandler } from 'express';
import { Router } from 'express';

import { createCustomerCommandSchema } from '../../modules/customers/application/use-cases/create-customer/CreateCustomerCommand.js';
import type { CreateCustomerUseCase } from '../../modules/customers/application/use-cases/create-customer/CreateCustomerUseCase.js';
import type { GetCustomerUseCase } from '../../modules/customers/application/use-cases/get-customer/GetCustomerUseCase.js';
import type { ListCustomersUseCase } from '../../modules/customers/application/use-cases/list-customers/ListCustomersUseCase.js';
import { requireOrganizationId } from '../middleware/organization-resolver.js';
import { requireRole } from '../middleware/require-role.js';
import { parseCustomerOrThrow } from '../validation.js';

/**
 * HTTP adapters for the customer catalog.
 *
 * The organization always comes from the verified JWT request context, never
 * from the body, path or query. Reads are available to every authenticated
 * role; writes require ADMIN or DISPATCHER. There is no delete or update route:
 * customers are catalog records and the ratified CRUD surface stops at create,
 * list and get.
 */
export interface CustomersHttpPorts {
  readonly createCustomer: CreateCustomerUseCase;
  readonly listCustomers: ListCustomersUseCase;
  readonly getCustomer: GetCustomerUseCase;
}

const createCustomerBodySchema = createCustomerCommandSchema.omit({
  organizationId: true,
});

export function createCustomersRouter(
  ports: CustomersHttpPorts,
  authenticate: RequestHandler,
): Router {
  const router = Router();

  router.use(authenticate);

  router.post('/', requireRole('ADMIN', 'DISPATCHER'), async (request, response) => {
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

  router.get('/', async (_request, response) => {
    const result = await ports.listCustomers.execute({
      organizationId: requireOrganizationId(response),
    });

    response.status(200).json({ data: result.customers });
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
