# Feature: Foundations + delivery-orders pilot module

Objective: execute the next milestone of the architecture plan (v0.2) — ADR-001/002/003, conceptual data model, and the pilot module `delivery-orders` with its docs and tests.
Branch: main (new repo). Delivery strategy: ask-on-risk. Test runner: vitest.
Delegation: all tasks delegated to bounded workers (user preference); parent orchestrates, owns git, and spot-checks.

## Specs

- S1: Milestone (plan §12): "Crear ADR-001 (monolito modular hexagonal + slices), ADR-002 (PostgreSQL/TypeORM), ADR-003 (JWT), modelo conceptual de datos y el primer módulo piloto `delivery-orders` con sus documentos y pruebas."
- S2: User delegation preference: "subdelega todo lo posible, no quiero que las tareas lo hagas con el orquestador" — every implementation/docs/verification task goes to a subagent; the parent only plans, hands off, owns git, and spot-checks.
- S3: Ratified decisions (plan §11) apply: multi-tenant `organizationId`; users by ADMIN only; orders with multiple packages; incident → failed attempt → return to warehouse, no field retries; GPS simulated; React+TS own stack (Vite+Tailwind+shadcn/ui, Leaflet); JWT 15min/7d refresh, HttpOnly+Secure+SameSite=Strict.
- S4: Timezone decision (plan §2): America/Lima everywhere (DB, API, UI, logs, audit).
- S5: Architecture rules (plan §3) apply: domain imports no Express/TypeORM/HTTP libs; use cases depend on ports; TypeORM only in infrastructure; vertical slices; composition root; no cross-module repository access; strict TS flags; runtime validation of external input; typed domain errors + central error middleware (future); transactions for coordinated order/stop/route changes (future); English names for code/DB/endpoints/architecture docs, Spanish UI (future).
- S6: Reference Manifest is visual-UI-only (external repo), stack never reused (plan §2).
- S7: Test-first discipline: RED before GREEN per requested rule; report `<command>: <observed result>` for every verification command.
- S8: Tech artifacts in English (code, docs, ADRs, commits). Assumption: npm workspaces as monorepo tool (plan §2 leaves package tooling open; npm chosen for zero extra tooling).

## Tasks

- T1: Repo foundations: monorepo scaffold (npm workspaces: apps/api, apps/web placeholder, packages/api-contracts), strict TS config, ESLint (no-explicit-any), vitest, .env.example, README, .gitignore; ADR-001, ADR-002, ADR-003 in docs/architecture/decisions/; conceptual data model in docs/architecture/data-model.md. Route: delegated (Writer A). Status: DONE — commit e9065d7, native review granted (lens readability) and acknowledged (lineage review-140e96aca855f874, authority burned). 4 advisory findings recorded in L6, fixes folded into T2.
- T2: Pilot module `delivery-orders` in apps/api/src/modules/delivery-orders: domain (entities, VOs, events, policies, errors), application (ports, use cases create/get), Zod validation, shared helpers (ids, clock), tests (vitest, in-memory fakes, org scoping), module docs (README, architecture, business-rules, data-model, api-contracts, decisions). Route: delegated (Writer B). Status: DONE — commit 8f2236e, 27 tests green, all four L6 review fixes applied; native assess: medium, under_budget (no review due, stays pending in slice).
- T3: Verification and closure: parent re-runs one reported command per writer (spot check), runs seam checks (full test suite, typecheck, lint), attempts native risk assessment per commit, commits work units, updates this file and the Engram mirror. Route: parent (orchestration + state). Status: DONE — spot checks and seam checks green (npm test 27/27, typecheck 0, lint 0); native flow executed: e9065d7 assessed high → user granted review → readability approved → acknowledged (authority burned); 8f2236e assessed medium/under_budget → no review due.

## Log

- L1 (2026-10-26): User request verbatim: "procede por favor" — proceeding with the previously proposed next milestone.
- L2 (2026-10-26): User constraint verbatim: "subdelega todo lo posible, no quiero que las tareas lo hagas con el orquestador, entiendes ¿?" — all tasks delegated; parent orchestrates only.
- L3 (2026-10-26): Milestone definition quoted from plan §12 (see S1).
- L4 (2026-10-26): Ratified decisions and corrections recorded in plan §11 (see S3); incident rule: any incident → failed attempt → warehouse return, no field retries; "no responde al celular" maps to `other`.
- L5 (2026-10-26): Repo initialized (git init, main), plan doc committed as baseline 4700305. npm workspaces assumed (S8).
- L6 (2026-10-26): T1 delivered by Writer A; spot check typecheck=0. Native assess: high_risk (ADR-003 authentication docs) → user granted review of e9065d7 → readability lens approved → acknowledged (lineage review-140e96aca855f874, authority burned). Non-blocking advisory findings to fix in T2: R2-tsconfig-gate-divergence (WARNING, tsconfig.json:6 gate ignores per-app configs), R2-env-credential-duplication (.env.example:15), R2-adr-status-vocabulary (ADR-002 §6 stale statuses), R2-engines-understated (package.json:12 engines >=22 vs toolchain >=22.13).
- L7 (2026-10-26): T2 launched: Writer B implements the delivery-orders pilot module plus the four L6 fixes.
- L8 (2026-10-26): T2 done by Writer B: 35 files created (module + shared + docs), 4 review fixes applied, RED observed (4 failing suites, unresolved planned modules) then GREEN (27/27). Parent spot check: npm test 27 passed, typecheck 0 (web config deferred until first web source, documented). Commit 8f2236e. Native assess over 8f2236e: risk medium, review_due false (under_budget) — stays pending in slice, no review ceremony.
- L9 (2026-10-26): Feature closed. Open follow-ups (non-blocking, documented in module docs): events publish after save without outbox; publicCode caller-supplied (DO-002); in-memory repo without durability; HTTP error mapping for forbidden→404 (DO-003); web typecheck gate activates with first web source.
