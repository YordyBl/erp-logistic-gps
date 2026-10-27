# `vehicles` module

Fleet catalog for one organization: the vehicles available for delivery routes.
Capacity is optional because some vehicle types do not declare a payload.

**Status:** domain, application, TypeORM persistence, migration
`1793232002000-Vehicles`, HTTP routes, unit tests, route tests and gated
PostgreSQL integration tests are implemented.

## Responsibility

| In scope | Out of scope (later milestones) |
|---|---|
| `Vehicle` entity with per-organization plate | Route assignment and availability conflicts |
| Create, list, get and partial update | Maintenance history, GPS devices and telemetry |
| ADMIN/DISPATCHER writes, every role reads | Vehicle type taxonomy (free text in the MVP) |
| Per-organization uniqueness of `plate` | Delete: deactivate through `status` instead |

## HTTP contract

| Method | Path | Roles | Result |
|---|---|---|---|
| `POST` | `/api/v1/vehicles` | ADMIN, DISPATCHER | `201` with `Location`; `409 VEHICLE_INVARIANT_VIOLATION` on a repeated plate |
| `GET` | `/api/v1/vehicles` | ADMIN, DISPATCHER, DRIVER | `200` with the caller organization vehicles, oldest first |
| `GET` | `/api/v1/vehicles/{vehicleId}` | ADMIN, DISPATCHER, DRIVER | `200`, or `404 VEHICLE_NOT_FOUND` |
| `PATCH` | `/api/v1/vehicles/{vehicleId}` | ADMIN, DISPATCHER | `200`, `400 VEHICLE_INVALID_INPUT`, or `404 VEHICLE_NOT_FOUND` |

The update is a `PATCH` with at least one mutable field. `plate` and the tenant
are not editable: the plate is the fleet identifier and changing it is a
re-registration. Omitting `capacityKg` keeps the stored value; sending `null`
clears it explicitly.

## Fields and invariants

| Field | Rule |
|---|---|
| `plate` | 3–16 chars, `[A-Z0-9]` groups separated by hyphens; trimmed and uppercased; unique per organization; immutable |
| `type` | 2–40 chars, trimmed free text (`van`, `truck`, `motorcycle`, …) |
| `capacityKg` | positive number up to 100 000, or `null`; stored as `numeric(10,2)` |
| `status` | `active` or `inactive`; defaults to `active` on create |
| `createdAt`, `updatedAt` | ISO-8601 instants; `updatedAt >= createdAt` is also a database check |

`uq_vehicles_organization_plate` is the correctness boundary for uniqueness. The
use case pre-checks the plate; the adapter translates the PostgreSQL `23505`
violation into the same `VehicleInvariantError`.

The vehicle type is free text in this milestone. Ratifying a closed enum belongs
to the dispatch module, which will own compatibility rules between vehicle types
and routes.

## Boundaries

- Domain imports only `shared/ids` and `shared/errors`; never Zod, TypeORM or
  Express (ADR-001 rule 1).
- Application use cases depend on `VehicleRepository`, `Clock` and `IdGenerator`
  ports.
- The update re-reads with the tenant in the key, so another organization's id
  is a not-found and no write happens. The entity re-validates the merged result,
  so an update cannot bypass creation invariants.
- TypeORM lives in `infrastructure/persistence`; the production composition is
  `createVehiclesModuleFromDataSource` and has no in-memory fallback.
- The TypeORM entity declares the organization relation with the string target
  `OrganizationEntity` and a structural interface, so this module never imports
  the identity module's infrastructure.

## Code map

```text
vehicles/
├── domain/
│   ├── entities/Vehicle.ts
│   └── errors/VehicleError.ts
├── application/
│   ├── dto/VehicleDto.ts
│   ├── ports/{VehicleRepository,Clock,IdGenerator}.ts
│   ├── validation.ts
│   └── use-cases/{create-vehicle,list-vehicles,get-vehicle,update-vehicle}/
├── infrastructure/persistence/
│   ├── entities/VehicleEntity.ts
│   ├── mappers/VehicleMapper.ts
│   ├── postgres-error.ts
│   ├── VehicleTypeOrmRepository.ts
│   └── VehicleTypeOrmRepository.integration.test.ts
├── composition/composition-root.ts
├── tests/vehicles.test.ts
└── docs/README.md
```

## Tests

```bash
env -u DATABASE_URL npx vitest run src/modules/vehicles   # unit; integration skips
DATABASE_URL=postgres://<user>:<password>@localhost:5432/erp_logistic \
  npx vitest run src/modules/vehicles                     # unit + PostgreSQL
```

The integration probe requires the migrated catalog table. A reachable database
without it fails loudly instead of skipping, because a missing migration is a
defect, not an environment limitation.
