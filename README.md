# ERP Logistic — last-mile delivery platform for Lima

Monorepo for a multi-tenant last-mile delivery ERP covering Lima
Metropolitana and Callao. Dispatchers plan routes with multiple stops and multiple orders
per stop, drivers confirm each delivery independently with photo evidence, and recipients
follow a single order through a limited public link.

**Status:** foundations and the pilot `delivery-orders` module are implemented: domain,
application use cases, Zod validation, unit tests, in-memory composition and module docs.
There is no HTTP server, database wiring, Docker setup or web UI yet.

## Quick path

1. Install Node 22.13 or newer (`.nvmrc` is provided): `nvm use`
2. Install dependencies: `npm install`
3. Run the quality gates:

```bash
npm test        # vitest run --passWithNoTests
npm run typecheck
npm run lint
```

All three must exit 0 before a change is ready for review. `npm run build` currently runs
the type check; the real build pipeline arrives with the application skeleton.

## Repository layout

| Path | Purpose |
|---|---|
| `apps/api` | Node.js + Express + TypeScript API. Contains shared helpers and the `delivery-orders` module; HTTP and persistence adapters arrive later. |
| `apps/api/src/modules/delivery-orders` | Pilot module: domain, use cases, ports, in-memory composition, tests and docs. |
| `apps/web` | React + TypeScript client placeholder (dispatcher console, driver view, public tracking). |
| `packages/api-contracts` | HTTP contracts shared by the API and the web client. |
| `docs/architecture` | Architecture decisions and the conceptual data model. |
| `ERP_LOGISTICO_LIMA_PLAN_ARQUITECTURA_v0.2.md` | Architecture plan (Spanish, source of truth for every decision). |

## Stack

| Area | Choice |
|---|---|
| API | Node.js 22.13+ + Express + strict TypeScript (ADR-001) |
| Web | React + TypeScript with Vite + Tailwind + shadcn/ui; Leaflet first, map layer isolated for a later MapLibre migration (plan §11.6) |
| Data | PostgreSQL + TypeORM Data Mapper; PostGIS recommended, pending (ADR-002) |
| Auth | JWT access (15 min) + rotating opaque refresh (7 days) (ADR-003) |
| Monorepo | npm workspaces |

## Commands

| Command | What it does |
|---|---|
| `npm test` | Runs the Vitest suite (`apps/api/src/**/*.test.ts`). |
| `npm run typecheck` | Type-checks each workspace with its own tsconfig: root tooling, `apps/api`, `packages/api-contracts`, and `apps/web` once it has sources. |
| `npm run lint` | ESLint flat config; explicit `any` is an error. |
| `npm run build` | Placeholder: currently runs the type check. |

`npm run typecheck` runs `typecheck:root`, `typecheck:api`, `typecheck:contracts` and
`typecheck:web`. The web config is applied as soon as `apps/web/src` contains a `.ts` or
`.tsx` file; TypeScript rejects an empty `include`, so the gate defers it while the
placeholder has no sources.

## Documentation

| Document | Content |
|---|---|
| [Architecture plan](ERP_LOGISTICO_LIMA_PLAN_ARQUITECTURA_v0.2.md) | Source of truth (Spanish): stack, rules, business model, security policy, phases. |
| [ADR-001](docs/architecture/decisions/ADR-001-modular-monolith-hexagonal-slices.md) | Modular monolith, hexagonal architecture, vertical slices, module template, required docs. |
| [ADR-002](docs/architecture/decisions/ADR-002-postgresql-typeorm.md) | PostgreSQL + TypeORM Data Mapper, migrations, transactions, spatial data. |
| [ADR-003](docs/architecture/decisions/ADR-003-jwt-auth.md) | JWT access/refresh policy, cookies, RBAC, public tracking tokens, WebSocket auth. |
| [Conceptual data model](docs/architecture/data-model.md) | Entities, Mermaid ER diagram, invariants and tenant/timezone conventions. |
| [`delivery-orders` module](apps/api/src/modules/delivery-orders/docs/README.md) | Pilot module: architecture, business rules, data model, proposed API contracts and local decisions. |

## Conventions

- **Strict TypeScript**: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`
  (`tsconfig.base.json`); ESLint forbids explicit `any`.
- **Architecture**: domain code imports no Express, TypeORM or HTTP libraries; use cases
  depend on ports; adapters are wired in a composition root (ADR-001).
- **Tenancy**: every business entity carries `organizationId`; internal UUID ids and
  readable public codes are separate from tracking tokens.
- **Language**: code, database, endpoints and architecture documents in English; the user
  interface in Spanish.
- **Time**: America/Lima across database, API, UI, logs and audit.
- **Secrets**: only in `.env` (copy `.env.example`); never commit real values.

## Current status

Done in this milestone:

- npm workspaces scaffold (`apps/api`, `apps/web`, `packages/api-contracts`).
- Strict TypeScript, ESLint and Vitest gates wired at the root, with per-workspace type checks.
- ADR-001, ADR-002, ADR-003 and the conceptual data model.
- Pilot `delivery-orders` module: aggregate, value objects, status policy, typed errors,
  create/get use cases, Zod validation, in-memory composition root, 27 unit tests and six
  module documents.
- Placeholder environment file, editor config and Node version pin (22.13+).

Next milestone: persist orders with TypeORM/PostgreSQL, add the HTTP adapter and
authentication scope, then start the identity/catalogues phase.
