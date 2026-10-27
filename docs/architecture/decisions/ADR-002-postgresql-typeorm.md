# ADR-002: PostgreSQL with TypeORM in Data Mapper mode

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Engineering, architecture plan v0.2
- **Supersedes:** none

## Context

The ERP stores strongly related operational data: organizations, customer accounts,
orders with packages, routes, stops, drivers, vehicles, GPS readings, delivery attempts,
proof of delivery, evidence metadata and incidents. The business rules depend on
constraints and multi-row transactions (for example, an incident must mark an attempt
failed and return the order to the warehouse atomically). The ratified stack
(architecture plan section 2) fixes PostgreSQL as the database and TypeORM as the ORM,
with Docker Compose for local development.

The architectural rules (ADR-001) also require that the domain layer never imports
TypeORM and that persistence entities stay separate from domain aggregates. This ADR
records how the database and ORM are used so those rules are not eroded by convenience.

## Decision

### 1. PostgreSQL is the system of record

PostgreSQL is the only system of record for operational data. It provides transactions,
foreign keys, check/unique/partial indexes and `timestamptz`, which the business
invariants rely on. Binary evidence is stored outside PostgreSQL (S3-compatible object
storage, MinIO for the demo); the database stores metadata only, per architecture plan
section 9A.

### 2. TypeORM in Data Mapper mode

Only the Data Mapper pattern is used. Active Record entities and business logic inside
entities are not allowed. TypeORM lives exclusively in each module's
`infrastructure/persistence` folder.

| Concern | Location |
|---|---|
| Domain aggregate/entity (pure TypeScript) | `<module>/domain/entities` |
| TypeORM entity (decorated, table mapping) | `<module>/infrastructure/persistence/entities` |
| Mapper between domain and TypeORM entity | `<module>/infrastructure/persistence/mappers` |
| Repository port | `<module>/application/ports` |
| Repository adapter | `<module>/infrastructure/persistence/repositories` |

TypeORM entities may use decorators and database-specific types. Domain aggregates must
not. Mapping is explicit and lives in one place per aggregate, so persistence changes do
not leak inward. Repositories return domain objects and accept domain objects; no
TypeORM `QueryBuilder` crosses the adapter boundary.

### 3. Schema changes are migrations, never synchronization

`synchronize: false` in every environment, including local development and tests. The
schema evolves only through reviewed migrations under `apps/api/migrations`. Migrations
run as a separate job/process, never implicitly on application boot; `main.ts` does not
run migrations. This keeps deployments deterministic and avoids concurrent migration
attempts between replicas.

Migrations are forward-only for the demo. Destructive changes require an explicit
rollback plan or a follow-up migration; no automatic data loss.

### 4. Transactions are owned by use cases

A use case that changes several aggregates uses one transaction through a unit-of-work
port backed by the TypeORM transaction manager. Coordinated changes (order + stop +
route, incident + attempt + order status) commit or roll back together. Repositories
never open their own independent transactions.

### 5. PostGIS is recommended, not yet enabled

Spatial data is a first-class need (stop coordinates, simulated vehicle positions,
Lima-area queries), so PostGIS is the recommended extension. Enabling it is pending
ratification (architecture plan section 11.10). When approved, it is enabled by a
migration (`CREATE EXTENSION IF NOT EXISTS postgis`), geometry columns are used only
where they add query value, and GiST indexes are added in the same migration. The MVP
can start with `numeric` latitude/longitude columns; no code should assume PostGIS until
the decision is ratified.

### 6. Stack decisions inherited from the architecture plan

| Area | Decision | Status |
|---|---|---|
| Backend | Node.js + Express + strict TypeScript | Confirmed |
| Architecture | Modular monolith, hexagonal, vertical slices | Confirmed (see ADR-001) |
| ORM | TypeORM, Data Mapper | Confirmed |
| Database | PostgreSQL | Confirmed |
| Containers | Docker + Docker Compose, multi-stage builds | Planned; not scaffolded yet (deployment milestone) |
| Spatial data | PostGIS | Recommended, pending |
| Runtime validation | Zod | Confirmed for application/HTTP boundary validation; OpenAPI tooling pending |
| Testing | Vitest (wired at the root); Supertest and Testcontainers pending | Vitest confirmed; the rest pending |
| API | Versioned REST + OpenAPI 3.1 | Recommended, pending |
| Timezone | America/Lima across database, API, UI, logs and audit | Confirmed |

Vitest is already the repository test runner. HTTP contract tooling (OpenAPI),
Supertest/Testcontainers integration testing and the spatial stack are decided in their
own milestones; this ADR does not pre-empt them. Docker Compose remains planned until the
deployment milestone adds the local stack.

### 7. Data conventions

- Table and column names are lowercase English `snake_case`; table names are plural
  (`delivery_orders`, `delivery_order_packages`). Indexes and constraints follow
  `idx_<table>_<columns>`, `uq_<table>_<columns>` and `chk_<table>_<rule>`, with
  framework-generated primary-key and foreign-key names.
- Primary keys are internal UUIDs. Readable public codes (order, route, package) are
  separate columns with their own per-organization uniqueness; see
  `docs/architecture/data-model.md`.
- Every business table carries `organization_id`; tenant filtering is mandatory in every
  query and is enforced by the repository adapter plus use-case authorization checks.
- Timestamps use `timestamptz`. Database sessions and API serialization default to
  `America/Lima`, matching the ratified timezone decision. Storing instants as
  `timestamptz` preserves them while presentation follows Lima time.
- Enumerations are stored as PostgreSQL enums or text with a check constraint, mapped to
  TypeScript unions in the persistence layer, never exposed directly as domain types.
- Sensitive values (password hashes, refresh token hashes, tracking token hashes) are
  stored as hashes only and never logged.

## Consequences

**Positive**

- The domain stays framework-free and unit-testable; TypeORM can be replaced without a
  domain rewrite.
- Explicit migrations give reviewable schema history and safe deployments.
- Transaction ownership at the use-case level keeps multi-aggregate rules atomic.
- PostgreSQL constraints back up the invariants that matter most.

**Negative / trade-offs**

- Manual mapping adds boilerplate and must be kept in sync with schema changes.
- Developers cannot use TypeORM relation traversal directly from the domain; this is
  intentional friction.
- Migrations add process overhead: every schema change needs a migration and a test.
- Without `synchronize`, a missing migration fails at runtime rather than being silently
  fixed, which is the desired behavior but requires discipline.

**Follow-ups**

- Ratify PostGIS, runtime validation (Zod), OpenAPI tooling and Testcontainers
  (architecture plan section 11.8-11.13).
- Add the migrations job to Docker Compose and CI once the API skeleton exists.
- Add integration tests against a real PostgreSQL instance for every repository
  adapter.
