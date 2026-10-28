# ERP Logistic — last-mile delivery platform for Lima

Monorepo for a multi-tenant last-mile delivery ERP covering Lima Metropolitana and Callao.
Dispatchers plan routes with multiple stops and orders, drivers confirm deliveries with
photo evidence, and recipients follow a single order through a limited public link.

**Status (2026-10-27):** Phase 1 is implemented. The `identity-and-access` module (users,
organizations, Argon2id passwords, rotating refresh tokens), the HTTP JWT surface (login,
refresh, logout, `me`, ADMIN-only user creation), the customer/driver/vehicle catalogs, the
demo seed and the OpenAPI 3.1 contract are in place. The web client is still a placeholder,
so `apps/web` keeps serving the static page.

## Quick path

Prerequisites: Node.js 22.13+ (`.nvmrc` provided), Docker Engine and Docker Compose. The
demo overlay needs Compose >= 2.20. No Docker is required for the unit and HTTP suites.

### Development stack

```bash
cp .env.example .env
docker compose up -d postgres
docker compose run --rm --build migrations
docker compose up --build
```

| Service | URL |
|---|---|
| API liveness | http://localhost:3000/healthz |
| API readiness (PostgreSQL) | http://localhost:3000/readyz |
| Web placeholder | http://localhost:8080 |

Migrations are a one-shot job, not part of API boot. The API does not wait for that job, so
the sequence above makes the schema deterministic before the API starts. `docker compose up`
alone runs the same job, but a request can arrive first.

### Demo data

`apps/api/src/scripts/seed-demo.ts` creates one demo organization and its three users. It
uses the same environment as the API (`DATABASE_URL` and `JWT_SECRET`), is never mounted on
an HTTP route, and is idempotent: a second run reuses the existing organization and leaves
existing users untouched.

```bash
export DATABASE_URL=postgres://<user>:<password>@localhost:5432/erp_logistic
export JWT_SECRET="$(openssl rand -hex 32)"   # any valid secret; the seed issues no tokens
npm run seed:demo -w apps/api
```

| Role | Email | Password |
|---|---|---|
| ADMIN | `admin@demo.lima` | `Admin-demo-1` |
| DISPATCHER | `dispatcher@demo.lima` | `Dispatcher-demo-1` |
| DRIVER | `driver@demo.lima` | `Driver-demo-1` |

These credentials are **documented demo values, not production credentials**: they are
published on purpose so anyone can sign in to a local demo. The script refuses to run when
`NODE_ENV=production`, and its output also prints the demo `organizationId`, which
`POST /api/v1/auth/login` requires. Never reuse this seed or these passwords in a deployed
environment.

### Demo stack

```bash
docker compose -f docker-compose.demo.yml up --build
```

The demo includes the development file, adds restart policies and resource limits, and uses
its own project name. It starts with empty tables: apply migrations and run the demo seed
(above) once to get the demo organization and users.

### Local API without Docker

Point the API at a reachable PostgreSQL and run the migrations once:

```bash
npm ci
export DATABASE_URL=postgres://<user>:<password>@localhost:5432/erp_logistic
export JWT_SECRET="$(openssl rand -hex 32)"
npm run migration:run -w apps/api
npm run seed:demo -w apps/api     # optional: demo organization and users
npx tsx apps/api/src/main.ts
```

The API reads process environment only. To use `.env` locally, load it first
(`set -a; . ./.env; set +a`). Without `DATABASE_URL`, the data source falls back to the
throwaway `POSTGRES_*` defaults from `.env.example`.

## Verification

| Command | What it proves |
|---|---|
| `npm test` | Unit and HTTP tests; PostgreSQL integration tests skip when `DATABASE_URL` is absent |
| `npm run typecheck` | Every workspace type-checks under the strict base config |
| `npm run lint` | ESLint flat config; explicit `any` is an error |
| `docker compose config --quiet` | Development Compose file interpolates |
| `docker compose -f docker-compose.demo.yml config --quiet` | Demo overlay includes and validates |
| `docker compose build` | All images build; build every service because migrations has its own tag |

To run the integration tests, start PostgreSQL (`docker compose up -d postgres`), apply
migrations, and set `DATABASE_URL` to that database before `npm test`. Without
`DATABASE_URL`, the PostgreSQL integration tests skip with a logged reason; a reachable
database without the migrated schema fails instead of skipping, because a missing migration
is a defect.

## Repository layout

| Path | Purpose |
|---|---|
| `apps/api` | Express 5 API: HTTP layer, configuration, TypeORM data source, migrations, middleware and routers. |
| `apps/api/src/modules/identity-and-access` | Users, organizations, Argon2id hashing, JWT/refresh sessions, RBAC context, tests and docs. |
| `apps/api/src/modules/delivery-orders` | Pilot module: domain, use cases, ports, persistence adapter, HTTP adapter, tests and docs. |
| `apps/api/src/modules/customers`, `drivers`, `vehicles` | Org-scoped catalogs: domain, use cases, TypeORM persistence, HTTP routes and module docs. |
| `apps/api/src/scripts/seed-demo.ts` | Demo seed: demo organization plus ADMIN/DISPATCHER/DRIVER users with documented demo credentials. |
| `apps/web` | Static placeholder served by nginx; the React client arrives in a later phase. |
| `packages/api-contracts` | Shared HTTP contracts between API and web client (reserved). |
| `docs/api/openapi.yaml` | OpenAPI 3.1 contract for the current HTTP surface. |
| `docs/architecture` | ADRs and the conceptual data model. |
| `.github/workflows/ci.yml` | Lint/typecheck/tests, PostgreSQL integration and image builds. |
| `ERP_LOGISTICO_LIMA_PLAN_ARQUITECTURA_v0.2.md` | Architecture plan (Spanish, source of truth for decisions). |

## What the API does today

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/auth/login` | Authenticate and start a session; access token in the body, refresh token in a strict cookie |
| `POST` | `/api/v1/auth/refresh` | Rotate the refresh cookie and return a new access token |
| `POST` | `/api/v1/auth/logout` | Revoke the current refresh token and clear the cookie |
| `GET` | `/api/v1/auth/me` | Return the authenticated caller |
| `POST` | `/api/v1/users` | Create a user in the caller organization (ADMIN only) |
| `POST` | `/api/v1/delivery-orders` | Create an order; returns `201` and a `Location` header |
| `GET` | `/api/v1/delivery-orders` | List orders in the caller's organization |
| `GET` | `/api/v1/delivery-orders?publicCode=...` | Read one order by its per-organization public code |
| `GET` | `/api/v1/delivery-orders/:orderId` | Read one order by internal UUID |
| `PATCH` | `/api/v1/delivery-orders/:orderId` | Edit recipient, address or packages only in `created` (ADMIN or DISPATCHER) |
| `POST` | `/api/v1/delivery-orders/:orderId/cancel` | Cancel before transit while preserving the audited status history (ADMIN or DISPATCHER) |
| `GET` | `/api/v1/delivery-orders/:orderId/history` | Read audited order status changes |
| `POST` | `/api/v1/delivery-routes` | Plan sequenced stops and assign orders with an active driver and vehicle (ADMIN or DISPATCHER) |
| `GET` | `/api/v1/delivery-routes/:routeId` | Read a route in the caller's organization |
| `PATCH` | `/api/v1/delivery-routes/:routeId` | Reassign the driver or vehicle of a planned route without touching orders (ADMIN or DISPATCHER) |
| `POST` | `/api/v1/customers` | Create a customer (ADMIN or DISPATCHER) |
| `GET` | `/api/v1/customers`, `/api/v1/customers/:customerId` | List or read the customer catalog (any authenticated role) |
| `POST` | `/api/v1/drivers` | Create a driver (ADMIN or DISPATCHER) |
| `GET` | `/api/v1/drivers`, `/api/v1/drivers/:driverId` | List or read the driver catalog (any authenticated role) |
| `PATCH` | `/api/v1/drivers/:driverId` | Update the mutable driver fields (ADMIN or DISPATCHER) |
| `POST` | `/api/v1/vehicles` | Create a vehicle (ADMIN or DISPATCHER) |
| `GET` | `/api/v1/vehicles`, `/api/v1/vehicles/:vehicleId` | List or read the fleet catalog (any authenticated role) |
| `PATCH` | `/api/v1/vehicles/:vehicleId` | Update the mutable vehicle fields (ADMIN or DISPATCHER) |
| `GET` | `/healthz` | Liveness; never touches PostgreSQL |
| `GET` | `/readyz` | Readiness; `503` while PostgreSQL is unavailable |

All `/api/v1` business routes require `Authorization: Bearer <access token>`. The JWT
middleware verifies issuer, audience, expiry, not-before, subject, JTI and the pinned HS256
algorithm, then reloads the user from storage, so a deleted, disabled or demoted account
takes effect immediately. The organization comes only from the verified token; the old
`x-organization-id` header is gone. Catalog reads are open to every authenticated role;
catalog writes require ADMIN or DISPATCHER; user provisioning requires ADMIN. Every response
carries `x-request-id`; non-2xx API responses use one error envelope with a `correlationId`.

## Database and migrations

Schema changes happen only through reviewed migrations; `synchronize` is false everywhere.

```bash
npm run migration:run -w apps/api       # apply pending migrations
npm run migration:generate -w apps/api -- migrations/NameOfChange
npm run migration:revert -w apps/api    # revert the last migration
```

Review generated SQL before committing it: constrains, indexes and `timestamptz` types are
part of the design, not incidental output. The Compose `migrations` service reuses the API
Dockerfile but has its own image tag, so rebuild all services after changing migrations or
API code (`docker compose build`).

## Tests and CI

- **Unit and HTTP** (`apps/api/src/**/*.test.ts`): domain rules, use cases, validation,
  error mapping, correlation ids, health routes and supertest HTTP contracts.
- **PostgreSQL integration**: repository adapter tests that probe `DATABASE_URL` with a
  two-second timeout and skip with a logged reason when the database is absent.
- **CI** (`.github/workflows/ci.yml`): `verify` runs lint, typecheck and tests without a
  database; `integration` runs migrations and the full suite against a `postgres:16-alpine`
  service container; `images` builds every Compose image. There is no coverage gate yet.

## Architecture decisions

| Document | Decision |
|---|---|
| [ADR-001](docs/architecture/decisions/ADR-001-modular-monolith-hexagonal-slices.md) | Modular monolith, hexagonal layers, vertical slices, module template. |
| [ADR-002](docs/architecture/decisions/ADR-002-postgresql-typeorm.md) | PostgreSQL + TypeORM Data Mapper, migrations, transactions, spatial data. |
| [ADR-003](docs/architecture/decisions/ADR-003-jwt-auth.md) | JWT access/refresh policy, cookies, RBAC, public tracking tokens, WebSocket auth. |
| [ADR-004](docs/architecture/decisions/ADR-004-express-openapi.md) | Express 5, `/api/v1`, hand-written OpenAPI 3.1, error-envelope mapping, health exceptions. |
| [ADR-005](docs/architecture/decisions/ADR-005-observability.md) | pino JSON logs, correlation ids, redaction, America/Lima timestamps. |
| [ADR-006](docs/architecture/decisions/ADR-006-docker-and-environments.md) | Multi-stage non-root images, dev/demo Compose layout, migrations job, MinIO image decision. |
| [ADR-007](docs/architecture/decisions/ADR-007-identifiers-and-time.md) | UUIDv4 now with UUIDv7 as future upgrade, public codes, `timestamptz` and Lima time. |
| [ADR-008](docs/architecture/decisions/ADR-008-auth-implementation.md) | Auth implementation: HS256/jose, Argon2id parameters, refresh families, cookie flags, login rate limiting. |
| [OpenAPI 3.1](docs/api/openapi.yaml) | HTTP source of truth for the current endpoints and errors. |
| [Conceptual data model](docs/architecture/data-model.md) | Entities, Mermaid ER diagram, invariants, tenant and timezone conventions. |
| [`delivery-orders` docs](apps/api/src/modules/delivery-orders/docs/README.md) | Module business rules, architecture, data model and local decisions. |
| [Architecture plan](ERP_LOGISTICO_LIMA_PLAN_ARQUITECTURA_v0.2.md) | Source of truth (Spanish): stack, rules, business model, security, phases. |

## Conventions

- **Strict TypeScript**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`; ESLint forbids explicit `any`.
- **Architecture**: domain imports no Express/TypeORM/HTTP code; use cases depend on ports;
  adapters are wired in a composition root (ADR-001).
- **Tenancy**: every business entity carries `organizationId`; internal UUIDs and readable
  public codes are separate, and tracking tokens are separate secrets (ADR-007).
- **Language**: code, database, endpoints and architecture docs in English; the user
  interface in Spanish.
- **Time**: `timestamptz` instants, ISO-8601 on the wire, America/Lima rendering in logs and
  UI (ADR-007).
- **Secrets**: only in `.env` (copy `.env.example`); never committed and never baked into
  images.

## Current limitations

- The demo seed and its credentials are demo-only. Production onboarding still relies on an
  ADMIN creating users through `POST /api/v1/users`; there is no invitation email flow yet.
- Login rate limiting is process-local and resets on restart; a shared store is a later
  deployment change.
- No CORS/security headers or general audit trail yet; order status transitions have an audit history.
- The web client is a placeholder; the React application is not implemented.
- The API runs through `tsx` instead of a compiled production build.
- No backups, TLS/reverse proxy or observability backend.
- Manual route planning, driver/vehicle reassignment and redispatch of returned
  orders are implemented locally; route execution is still pending.
  Photo evidence and incidents belong to Phase 4, and tracking to Phase 5.

The architecture plan assigns orders to Phase 2, routes and dispatch to Phase 3,
delivery execution to Phase 4, and GPS tracking to Phase 5. The React client
remains a placeholder and does not yet consume this API.
