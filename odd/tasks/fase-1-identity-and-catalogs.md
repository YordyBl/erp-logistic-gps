# Feature: Fase 1 — Identity, JWT and catalogs

Objective: Fase 1 of the plan (§10): JWT authentication, roles, organizations/customers, drivers, vehicles. Replaces the temporary x-organization-id header with real JWT auth and closes the 6 advisory findings from the Fase 0 review.
Branch: main. Delivery strategy: ask-on-risk. Test runner: vitest (+ supertest).
Delegation: all tasks delegated (user preference); parent orchestrates, owns git, commits in SMALL review-friendly units (native reviewer budget lesson: candidates over ~10 files exceed the lens context budget), spot-checks.

## Specs

- S1: User request: "procede" — proceed with Fase 1 (plan §10: "Identidad y catálogos: JWT, roles, empresas/clientes, conductores, vehículos").
- S2: Delegation preference: "subdelega todo lo posible, no quiero que las tareas lo hagas con el orquestador".
- S3: Ratified identity policy (plan §11.2): users created ONLY by ADMIN (invitation); corporate client out of MVP; roles ADMIN, DISPATCHER, DRIVER.
- S4: Ratified JWT policy (plan §7 + §11.7): access JWT 15 min, explicit allowed algorithm; rotating refresh token 7 days, server-side hash persistence, revocation, reuse detection (reuse revokes the family); refresh in HttpOnly + Secure + SameSite=Strict cookie, no extra CSRF token in MVP; logout revokes current refresh; validate iss/aud/exp/nbf/sub/jti/alg; Argon2id password hashing; login rate limiting; RBAC roles.
- S5: Multi-tenant: every entity scoped by organizationId; organizations table created (FK from delivery_orders backfilled in migration); JWT carries sub (user id) and organizationId.
- S6: America/Lima everywhere (timestamps/logs/API), English artifacts, strict TS, hexagonal rules (plan §3), OpenAPI 3.1 updated with auth.
- S7: Test-first RED→GREEN; report `<command>: <observed result>`; integration tests skip cleanly without DATABASE_URL.
- S8: 6 advisory follow-ups from the Fase 0 review: ci.yml throwaway password documented as non-secret ephemeral; minio image pinned by digest; README hardcoded test counts removed; "Phase" instead of "Fase" in English docs; README:142 stale parenthetical fixed; x-organization-id spoofable warning resolved by JWT (this feature).
- S9: Assumptions (recorded, revisable): jose HS256 with explicit alg allowlist; argon2 (Argon2id); in-memory rate limiter for MVP; cookie Secure flag env-driven (false for local http dev, true in prod); demo seed script creates demo org + admin/driver/dispatcher users (documented demo credentials); delivery-orders resolves organization from JWT only (header removed).

## Tasks

- T1: Identity core: identity-and-access module (domain: User, Organization, roles, typed errors; use cases: login, refresh with rotation+reuse detection, logout, create-user-by-admin, create-organization); ports (UserRepository, RefreshTokenStore, PasswordHasher, TokenService, Clock); infrastructure (TypeORM entities organizations/users/refresh_tokens, Argon2id hasher, jose token service, migration 2 with organization backfill + FK from delivery_orders); unit + integration tests. Route: delegated (Writer A). Status: pending.
- T2: Auth HTTP: POST /api/v1/auth/login (rate-limited), /refresh (cookie), /logout, GET /api/v1/auth/me; JWT middleware replacing x-organization-id (verify iss/aud/exp/nbf/sub/jti/alg, set userId/orgId/role context); requireRole RBAC; delivery-orders wired to JWT context; cookie flags; OpenAPI updated; supertest suite (login, refresh rotation, reuse detection → family revoked, wrong org access, role enforcement). Route: delegated (Writer B). Status: pending.
- T3: Catalogs: customers, drivers, vehicles modules (domain + application + TypeORM infra + migrations + HTTP routes + module docs): org-scoped CRUD (create/list/get; update for drivers/vehicles), RBAC (ADMIN/DISPATCHER manage, DRIVER read-only), Zod validation, tests. Route: delegated (Writer C). Status: pending.
- T4: Demo seed + docs + the 6 advisory follow-ups (S8): seed script (demo org + users), README status/quickstart update, ADR-008 (auth implementation decisions: HS256/jose, Argon2id params, refresh family + reuse detection, cookie flags dev/prod, rate limiting), OpenAPI auth finalization. Route: delegated (Writer D). Status: pending.
- T5: Verification and closure: parent spot checks, seam checks (full suite with/without DB), native risk assessment per commit (base b17e1b8), consent relays, small work-unit commits per logical unit, feature doc + mirror updates. Route: parent. Status: pending.

## Log

- L1 (2026-10-27): User request verbatim: "procede" — proceeding with Fase 1.
- L2 (2026-10-27): Fase 0 closed (commits 997da0a..9ab82ca). Native review: CI candidate acknowledged (review-a68ab35eda2f05ed); middle range covered per user decision (native review unavailable, provider lens-context budget).
- L3 (2026-10-27): Lesson applied: work-unit commits kept small (≤ ~10 files) so native review candidates fit the provider budget.
- L4 (2026-10-27): Assumptions recorded in S9.
