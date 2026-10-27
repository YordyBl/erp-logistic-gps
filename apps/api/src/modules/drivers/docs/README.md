# `drivers` module

Driver catalog for one organization: the people who execute delivery routes.
Route assignment and the link to a platform user belong to later modules; this
module owns the master data only.

**Status:** domain, application, TypeORM persistence, migration
`1793232001000-Drivers`, HTTP routes, unit tests, route tests and gated
PostgreSQL integration tests are implemented.

## Responsibility

| In scope | Out of scope (later milestones) |
|---|---|
| `Driver` entity with per-organization document number | User account provisioning (`identity-and-access`) |
| Create, list, get and partial update | Route assignment, availability and conflict checks |
| ADMIN/DISPATCHER writes, every role reads | Driver document verification workflow |
| Per-organization uniqueness of `documentNumber` | Delete: deactivate through `status` instead |

## HTTP contract

| Method | Path | Roles | Result |
|---|---|---|---|
| `POST` | `/api/v1/drivers` | ADMIN, DISPATCHER | `201` with `Location`; `409 DRIVER_INVARIANT_VIOLATION` on a repeated document |
| `GET` | `/api/v1/drivers` | ADMIN, DISPATCHER, DRIVER | `200` with the caller organization drivers, oldest first |
| `GET` | `/api/v1/drivers/{driverId}` | ADMIN, DISPATCHER, DRIVER | `200`, or `404 DRIVER_NOT_FOUND` |
| `PATCH` | `/api/v1/drivers/{driverId}` | ADMIN, DISPATCHER | `200`, `400 DRIVER_INVALID_INPUT`, or `404 DRIVER_NOT_FOUND` |

The update is a `PATCH` with at least one mutable field. `documentNumber` and the
tenant are not editable: the identity document requires an identity-verification
workflow, not a catalog patch. Omitted fields keep their stored value and
`updatedAt` is stamped by the use-case clock.

## Fields and invariants

| Field | Rule |
|---|---|
| `fullName` | 2–120 chars, trimmed |
| `documentNumber` | 6–20 chars, `[A-Z0-9]` groups separated by hyphens; trimmed and uppercased; unique per organization; immutable |
| `phone` | 6–32 chars, digits/spaces/parentheses/hyphens, optional leading `+` |
| `licenseNumber` | 4–40 chars, same code shape as the document; trimmed and uppercased |
| `status` | `active` or `inactive`; defaults to `active` on create |
| `createdAt`, `updatedAt` | ISO-8601 instants; `updatedAt >= createdAt` is also a database check |

`uq_drivers_organization_document_number` is the correctness boundary for
uniqueness. The use case pre-checks the document; the adapter translates the
PostgreSQL `23505` violation into the same `DriverInvariantError`.

## Boundaries

- Domain imports only `shared/ids` and `shared/errors`; never Zod, TypeORM or
  Express (ADR-001 rule 1).
- Application use cases depend on `DriverRepository`, `Clock` and `IdGenerator`
  ports.
- The update re-reads with the tenant in the key, so another organization's id
  is a not-found and no write happens. The entity re-validates the merged result,
  so an update cannot bypass creation invariants.
- TypeORM lives in `infrastructure/persistence`; the production composition is
  `createDriversModuleFromDataSource` and has no in-memory fallback.
- The TypeORM entity declares the organization relation with the string target
  `OrganizationEntity` and a structural interface, so this module never imports
  the identity module's infrastructure.

## Code map

```text
drivers/
├── domain/
│   ├── entities/Driver.ts
│   └── errors/DriverError.ts
├── application/
│   ├── dto/DriverDto.ts
│   ├── ports/{DriverRepository,Clock,IdGenerator}.ts
│   ├── validation.ts
│   └── use-cases/{create-driver,list-drivers,get-driver,update-driver}/
├── infrastructure/persistence/
│   ├── entities/DriverEntity.ts
│   ├── mappers/DriverMapper.ts
│   ├── postgres-error.ts
│   ├── DriverTypeOrmRepository.ts
│   └── DriverTypeOrmRepository.integration.test.ts
├── composition/composition-root.ts
├── tests/drivers.test.ts
└── docs/README.md
```

## Tests

```bash
env -u DATABASE_URL npx vitest run src/modules/drivers   # unit; integration skips
DATABASE_URL=postgres://<user>:<password>@localhost:5432/erp_logistic \
  npx vitest run src/modules/drivers                     # unit + PostgreSQL
```

The integration probe requires the migrated catalog table. A reachable database
without it fails loudly instead of skipping, because a missing migration is a
defect, not an environment limitation.
