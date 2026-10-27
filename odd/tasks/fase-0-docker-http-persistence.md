# Feature: Fase 0 — Docker, HTTP and persistence foundations

Objective: complete Fase 0 of the plan (§10): Docker multi-stage builds, Compose dev/demo, TypeORM + PostgreSQL with migrations, Express HTTP layer with OpenAPI, structured logging, healthchecks, and CI. Pilot module delivery-orders gets its real infrastructure.
Branch: main. Delivery strategy: ask-on-risk. Test runner: vitest (+ supertest for HTTP).
Delegation: all tasks delegated to bounded workers (user preference S2); parent orchestrates, owns git, spot-checks.

## Specs

- S1: User request: "procede" — proceed with Fase 0 (dependency of Fase 1; plan §10).
- S2: Delegation preference (carried from previous feature): "subdelega todo lo posible, no quiero que las tareas lo hagas con el orquestador".
- S3: Plan §10 Fase 0 row: "Monorepo, Docker, PostgreSQL, TS strict, arquitectura, lint, testing, CI, OpenAPI, logging y healthchecks". Monorepo/TS-strict/arquitectura/lint/testing already done in the previous milestone; this feature delivers Docker, PostgreSQL/TypeORM, Express HTTP, OpenAPI, logging, healthchecks, CI.
- S4: Plan §9: Docker multi-stage builds, non-root execution, healthchecks, depends_on with readiness, persistent volumes for PostgreSQL, migrations as a separate job, synchronize:false, .env.example, secrets outside the repo, profiles development/test/demo; minimal services web, api, postgres, minio.
- S5: Plan §3 rules: TypeORM lives exclusively in infrastructure; entities separate from domain aggregates (rule 3); typed domain errors → central error middleware with consistent HTTP codes (rule 9); composition root (rule 5); strict TS + no explicit any (rule 7); runtime validation of external input (rule 8); English naming for code/DB/endpoints/docs (rule 11); UUID internal ids, public codes separate (rule 12).
- S6: America/Lima everywhere (plan §2): timestamps stored in DB, exposed by API, and logged in America/Lima (ratified decision).
- S7: OpenAPI 3.1 as source of truth for HTTP (plan §2). REST versioned: /api/v1.
- S8: Test-first discipline: RED before GREEN per requested rule; report `<command>: <observed result>` for every verification command. Integration tests against PostgreSQL must run when Docker is available and skip cleanly (documented) when not.
- S9: Tech artifacts in English. Assumptions (recorded, revisable): Express 5, pino for structured logs, hand-written OpenAPI 3.1 spec for now, UUIDv4 retained (crypto.randomUUID) with UUIDv7 documented as future upgrade, auth endpoints not part of Fase 0 (JWT lands in Fase 1; dev-only organization resolution middleware marked temporary).

## Tasks

- T1: Docker foundation: multi-stage Dockerfiles (api non-root; web static placeholder), .dockerignore, docker-compose.yml (postgres:16-alpine with volume+healthcheck, minio with volume+healthcheck, api with depends_on readiness, web, migrations one-shot job), docker-compose.demo.yml (demo profile), .env.example update, compose config validation. Route: delegated (Writer A). Status: DONE — commit pending; minio image ratified by user: pgsty/minio:RELEASE.2026-08-04T00-00-00Z (minio/minio no longer pullable).
- T2: Persistence infrastructure: TypeORM Data Mapper entities for delivery-orders in apps/api/src/modules/delivery-orders/infrastructure/persistence/, repository adapter implementing the domain ports, DataSource config (env-driven, synchronize:false), migrations (create tables: organizations? no — orders/packages tables with org scoping, UUIDs, timestamptz America/Lima convention), migration run script, integration tests against the compose PostgreSQL (skip when unavailable). Route: delegated (Writer B). Status: pending.
- T3: HTTP layer: Express 5 app in apps/api/src/http/ (routing, controllers for delivery-orders create/get mapped to /api/v1/delivery-orders), central error middleware mapping typed domain errors to HTTP codes, Zod request validation, pino structured logging with correlation ids, /healthz + /readyz, OpenAPI 3.1 spec in docs/api/, supertest HTTP tests, main.ts boot wiring, temporary dev organization middleware (x-organization-id) clearly marked until Fase 1 JWT. Route: delegated (Writer C). Status: pending.
- T4: CI + docs: .github/workflows/ci.yml (install, lint, typecheck, unit, integration with compose postgres, docker build), ADR-004 (Express + OpenAPI), ADR-005 (observability: pino + correlation ids), ADR-006 (Docker/dev-demo layout), ADR-007 (ids/timestamps: UUIDv4 now, v7 later; America/Lima handling), README updates. Route: delegated (Writer D). Status: pending.
- T5: Verification and closure: parent spot checks per task, seam checks (full suite, typecheck, lint, compose config, integration suite), native risk assessment per commit (boundary e9065d7; 8f2236e pending under_budget in slice), consent relays as required, work-unit commits, feature doc + mirror updates. Route: parent. Status: pending.

## Log

- L1 (2026-10-26): User request verbatim: "procede" — proceeding with Fase 0 (dependency of Fase 1).
- L2 (2026-10-26): Previous milestone closed: foundations + delivery-orders pilot (commits 4700305, e9065d7, 8f2236e, 976af82). Native review of e9065d7 granted/acknowledged; 8f2236e medium/under_budget pending in slice.
- L3 (2026-10-26): Environment verified: Docker 29.8.2 + Compose v5.5.1, daemon running; Node 22.23.3; npm 10.9.9; gentle-ai CLI available.
- L4 (2026-10-26): Assumptions recorded in S9 (Express 5, pino, hand-written OpenAPI, UUIDv4 now, temporary dev org middleware).
