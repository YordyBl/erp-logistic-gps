# ERP Logistic — last-mile delivery platform for Lima

Monorepo foundations for a multi-tenant last-mile delivery ERP covering Lima
Metropolitana and Callao. Dispatchers plan routes with multiple stops and multiple orders
per stop, drivers confirm each delivery independently with photo evidence, and recipients
follow a single order through a limited public link.

**Status:** planning and repo foundations complete. The pilot `delivery-orders` module is
the next milestone; there is no HTTP server, database wiring, Docker setup or web UI yet.

## Quick path

1. Install Node 22 (`.nvmrc` is provided): `nvm use`
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
| `apps/api` | Node.js + Express + TypeScript API. Modules, shared code and infrastructure arrive with the pilot module. |
| `apps/web` | React + TypeScript client placeholder (dispatcher console, driver view, public tracking). |
| `packages/api-contracts` | HTTP contracts shared by the API and the web client. |
| `docs/architecture` | Architecture decisions and the conceptual data model. |
| `ERP_LOGISTICO_LIMA_PLAN_ARQUITECTURA_v0.2.md` | Architecture plan (Spanish, source of truth for every decision). |

## Stack

| Area | Choice |
|---|---|
| API | Node.js 22 + Express + strict TypeScript (ADR-001) |
| Web | React + TypeScript with Vite + Tailwind + shadcn/ui; Leaflet first, map layer isolated for a later MapLibre migration (plan §11.6) |
| Data | PostgreSQL + TypeORM Data Mapper; PostGIS recommended, pending (ADR-002) |
| Auth | JWT access (15 min) + rotating opaque refresh (7 days) (ADR-003) |
| Monorepo | npm workspaces |

## Commands

| Command | What it does |
|---|---|
| `npm test` | Runs the Vitest suite (`apps/api/src/**/*.test.ts`). Passes with no tests while the scaffold has none. |
| `npm run typecheck` | Strict TypeScript check over every workspace source file. |
| `npm run lint` | ESLint flat config; explicit `any` is an error. |
| `npm run build` | Placeholder: currently runs the type check. |

## Documentation

| Document | Content |
|---|---|
| [Architecture plan](ERP_LOGISTICO_LIMA_PLAN_ARQUITECTURA_v0.2.md) | Source of truth (Spanish): stack, rules, business model, security policy, phases. |
| [ADR-001](docs/architecture/decisions/ADR-001-modular-monolith-hexagonal-slices.md) | Modular monolith, hexagonal architecture, vertical slices, module template, required docs. |
| [ADR-002](docs/architecture/decisions/ADR-002-postgresql-typeorm.md) | PostgreSQL + TypeORM Data Mapper, migrations, transactions, spatial data. |
| [ADR-003](docs/architecture/decisions/ADR-003-jwt-auth.md) | JWT access/refresh policy, cookies, RBAC, public tracking tokens, WebSocket auth. |
| [Conceptual data model](docs/architecture/data-model.md) | Entities, Mermaid ER diagram, invariants and tenant/timezone conventions. |

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
- Strict TypeScript, ESLint and Vitest gates wired at the root.
- ADR-001, ADR-002, ADR-003 and the conceptual data model.
- Placeholder environment file, editor config and Node version pin.

Next milestone: the pilot `delivery-orders` module (domain, use cases, Zod validation,
tests, module docs) per the architecture plan sections 10-12.
