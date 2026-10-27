# `customers` module

Customer catalog for one organization: the companies that contract delivery
services. It is catalog data, not an authenticated principal — corporate clients
have no login in the MVP and use public tracking only (plan §11.2).

**Status:** domain, application, TypeORM persistence, migration
`1793232000000-Customers`, HTTP routes, unit tests, route tests and gated
PostgreSQL integration tests are implemented.

## Responsibility

| In scope | Out of scope (later milestones) |
|---|---|
| `Customer` entity with per-organization public code | Authenticated customer accounts or portals |
| Create, list and get inside the caller organization | Update and delete: the ratified CRUD surface stops at create/list/get |
| ADMIN/DISPATCHER writes, every role reads | Linking customers to delivery orders (`delivery-orders` already carries its own recipient snapshot) |
| Per-organization uniqueness of `publicCode` | Bulk import, merge or deactivation workflow |

## HTTP contract

| Method | Path | Roles | Result |
|---|---|---|---|
| `POST` | `/api/v1/customers` | ADMIN, DISPATCHER | `201` with `Location`; `409 CUSTOMER_INVARIANT_VIOLATION` on a repeated code |
| `GET` | `/api/v1/customers` | ADMIN, DISPATCHER, DRIVER | `200` with the caller organization customers, oldest first |
| `GET` | `/api/v1/customers/{customerId}` | ADMIN, DISPATCHER, DRIVER | `200`, or `404 CUSTOMER_NOT_FOUND` |

There is deliberately no `PATCH`/`PUT`/`DELETE` route. The organization is read
from the verified JWT request context and is never accepted from the body, path
or query; a body with `organizationId` is rejected as an unknown property.

## Fields and invariants

| Field | Rule |
|---|---|
| `publicCode` | 3–32 chars, `[A-Z0-9]` groups separated by hyphens; trimmed and uppercased; unique per organization |
| `name` | 2–120 chars |
| `contactName` | 2–120 chars |
| `contactEmail` | valid address, at most 254 chars, trimmed and lowercased |
| `contactPhone` | 6–32 chars, digits/spaces/parentheses/hyphens, optional leading `+` |
| `status` | `active` or `inactive`; defaults to `active` on create |
| `createdAt` | ISO-8601 instant supplied by the use-case clock |

`uq_customers_organization_public_code` is the correctness boundary for
uniqueness. The use case pre-checks the code; the adapter translates the
PostgreSQL `23505` violation into the same `CustomerInvariantError`, so a
concurrent create cannot return a different error.

## Boundaries

- Domain imports only `shared/ids` and `shared/errors`; never Zod, TypeORM or
  Express (ADR-001 rule 1).
- Application use cases depend on the `CustomerRepository`, `Clock` and
  `IdGenerator` ports.
- TypeORM lives in `infrastructure/persistence`; the production composition is
  `createCustomersModuleFromDataSource` and has no in-memory fallback.
- Every repository read puts `organizationId` in the same query as the id or
  code. Another tenant's customer is therefore an ordinary not-found, which the
  HTTP layer maps to `404` for enumeration safety.
- The TypeORM entity declares the organization relation with the string target
  `OrganizationEntity` and a structural interface, so this module never imports
  the identity module's infrastructure.

## Code map

```text
customers/
├── domain/
│   ├── entities/Customer.ts
│   └── errors/CustomerError.ts
├── application/
│   ├── dto/CustomerDto.ts
│   ├── ports/{CustomerRepository,Clock,IdGenerator}.ts
│   ├── validation.ts
│   └── use-cases/{create-customer,list-customers,get-customer}/
├── infrastructure/persistence/
│   ├── entities/CustomerEntity.ts
│   ├── mappers/CustomerMapper.ts
│   ├── postgres-error.ts
│   ├── CustomerTypeOrmRepository.ts
│   └── CustomerTypeOrmRepository.integration.test.ts
├── composition/composition-root.ts
├── tests/customers.test.ts
└── docs/README.md
```

## Tests

```bash
env -u DATABASE_URL npx vitest run src/modules/customers   # unit; integration skips
DATABASE_URL=postgres://<user>:<password>@localhost:5432/erp_logistic \
  npx vitest run src/modules/customers                     # unit + PostgreSQL
```

The integration probe requires the migrated catalog table. A reachable database
without it fails loudly instead of skipping, because a missing migration is a
defect, not an environment limitation.
