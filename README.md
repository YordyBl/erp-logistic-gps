# ERP Logistic — last-mile delivery platform for Lima

Monorepo for a multi-tenant last-mile delivery ERP covering Lima Metropolitana and Callao.
Dispatchers plan routes with multiple stops and orders, drivers confirm deliveries with
photo evidence, and recipients follow a single order through a limited public link.

**Status (2026-10-30):** Phases 0–3 are closed in the feature logs. Phase 4 delivery execution
is implemented locally: drivers can start assigned routes, confirm deliveries with private
photo evidence, report incidents, and explicitly complete routes. The React web client includes
driver and dispatcher/admin workflows; native review and live MinIO integration verification
remain pending.

## Quick path

Prerequisites: Node.js 22.13+ (`.nvmrc` provided), Docker Engine and Docker Compose. The
demo overlay needs Compose >= 2.20. Docker Compose builds the API and React web images and runs
PostgreSQL and MinIO for a local end-to-end test. No Docker is required for unit and HTTP suites.

### Development stack

```bash
cp .env.example .env
docker compose up -d postgres minio
docker compose run --rm --build migrations
docker compose up --build
```

| Service | URL |
|---|---|
| API liveness | http://localhost:3000/healthz |
| API readiness (PostgreSQL) | http://localhost:3000/readyz |
| Web app | http://localhost:8080 |
| MinIO console | http://localhost:9001 |

Migrations are a one-shot job, not part of API boot. Run them before starting the full stack so
the API does not receive requests before its schema is ready. The web app proxies `/api` to the
API in the same origin, so sign-in and evidence requests work through `http://localhost:8080`
without browser CORS configuration. MinIO is private to the Compose network; its console is
exposed only for local development. Compose stores database and object data in named volumes.
To stop the stack without deleting that data, run `docker compose down`.

If the default host ports are already in use, set alternate values in `.env` before starting:
`POSTGRES_PORT`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT`, `API_PORT`, and `WEB_PORT`.

### Optional local route geometry

To enable the locally hosted Valhalla router, place the public Peru OSM extract in the
ignored `infra/valhalla/data/` directory and use the Compose override:

```bash
mkdir -p infra/valhalla/data
curl --fail --location --output infra/valhalla/data/peru-latest.osm.pbf \
  https://download.geofabrik.de/south-america/peru-latest.osm.pbf
docker compose -f docker-compose.yml -f docker-compose.valhalla.yml up --build
```

The first startup builds Peru routing tiles and can take several minutes; subsequent runs reuse
the local graph. Valhalla is exposed on loopback port `8002` by default (`VALHALLA_PORT` changes
it), and the API container uses the internal Compose address. The web route-planning form
accepts an optional Google Maps link per stop; the API resolves permitted Google Maps links
to coordinates used by Valhalla and GPS simulation. See
[`docs/operations/gps-tracking.md`](docs/operations/gps-tracking.md) for details.

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
`NODE_ENV=production`, and its output also prints the demo `organizationId`, which the
single-company deployment needs as server configuration. Never reuse this seed or these passwords in a deployed
environment.

### Sign in to the local app

After the stack is healthy, create the documented demo organization and users from the host.
The example below assumes the default PostgreSQL port; use the configured `POSTGRES_PORT` if
you changed it.

```bash
export DATABASE_URL=postgres://erp_logistic:change-me-local-only@localhost:5432/erp_logistic
export JWT_SECRET=dev-only-throwaway-secret-change-me-32-bytes
npm run seed:demo -w apps/api
```

Set the organization printed by the seed in the server configuration, then recreate the API:

```bash
export LOGIN_ORGANIZATION_ID=<organization-id-printed-by-seed>
docker compose up -d api
```

Open http://localhost:8080 and sign in with one of these local-only accounts:

| Role | Email | Password |
|---|---|---|
| ADMIN | `admin@demo.lima` | `Admin-demo-1` |
| DISPATCHER | `dispatcher@demo.lima` | `Dispatcher-demo-1` |
| DRIVER | `driver@demo.lima` | `Driver-demo-1` |

When `LOGIN_ORGANIZATION_ID` is configured, the server resolves the organization and the login
request accepts only email and password. Without it, the existing API contract requires an
explicit `organizationId`; the web form requires the single-company setting. These public demo credentials are for a local environment only—never use them in a
deployed environment. The seed refuses to run with `NODE_ENV=production`.

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
export EVIDENCE_S3_ENDPOINT=http://localhost:9000
export EVIDENCE_S3_BUCKET=delivery-evidence
export EVIDENCE_S3_REGION=us-east-1
export EVIDENCE_S3_ACCESS_KEY="${MINIO_ROOT_USER:-minioadmin}"
export EVIDENCE_S3_SECRET_KEY="${MINIO_ROOT_PASSWORD:-change-me-local-only}"
npm run migration:run -w apps/api
npm run seed:demo -w apps/api     # optional: demo organization and users
npx tsx apps/api/src/main.ts
```

The API container receives equivalent `EVIDENCE_S3_*` values from Compose and waits for
MinIO health. The local development bucket is private and is created on the first evidence
upload. Production must configure an HTTPS endpoint and externally managed credentials.

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
| `apps/api/src/modules/delivery-execution` | Delivery attempts, private photo evidence, delivery confirmation and incident outcomes. |
| `apps/api/src/modules/customers`, `drivers`, `vehicles` | Org-scoped catalogs: domain, use cases, TypeORM persistence, HTTP routes and module docs. |
| `apps/api/src/scripts/seed-demo.ts` | Demo seed: demo organization plus ADMIN/DISPATCHER/DRIVER users with documented demo credentials. |
| `apps/web` | React + TypeScript driver and dispatcher/admin client, built with Vite and served by nginx in Compose. |
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
| `POST` | `/api/v1/delivery-orders/:orderId/evidence` | Upload one private JPEG/PNG/WebP photo for the authenticated driver's active attempt (1–2 photos, maximum 5,000,000 bytes each) |
| `GET` | `/api/v1/delivery-orders/:orderId/evidence` | List evidence metadata for authorized organization users or the assigned driver |
| `GET` | `/api/v1/evidence/:evidenceId/download` | Stream available evidence after tenant/attempt authorization; never exposes a public object URL |
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
- Manual route planning, resource reassignment, redispatch, explicit driver-account binding
  and route start are implemented locally. Photo evidence storage is in progress; delivery
  confirmation, incident outcomes, explicit route completion and the React driver/admin views
  remain pending in Phase 4. Tracking belongs to Phase 5.

The architecture plan assigns orders to Phase 2, routes and dispatch to Phase 3,
delivery execution to Phase 4, and GPS tracking to Phase 5. The React client
remains a placeholder and does not yet consume this API.
