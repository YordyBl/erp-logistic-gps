# ADR-004: Express 5, versioned REST and hand-written OpenAPI 3.1

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Engineering, architecture plan v0.2
- **Supersedes:** none

## Context

Fase 0 needs a real HTTP boundary for the pilot `delivery-orders` module. The ratified
stack (architecture plan section 2) fixes Node.js + Express + strict TypeScript, and the
architecture rules (ADR-001 rule 9) require typed errors and one central error middleware
with consistent status codes. The plan also recommends REST versioning and OpenAPI 3.1 as
the HTTP source of truth (sections 2 and 11.8). Authentication is a Fase 1 concern
(ADR-003); Fase 0 must therefore expose the module without pretending the temporary tenant
header is authorization.

The HTTP layer receives composed use cases rather than constructing them. That keeps the
Express app constructible in tests with in-memory adapters and keeps framework code out of
the domain and application layers.

## Decision

### 1. Express 5 behind a `buildApp` factory

`apps/api/src/http/app.ts` exports `buildApp({ deliveryOrders, readiness, logger })`. It
reads no configuration, opens no connections and never imports a concrete repository.
`apps/api/src/main.ts` is the composition root: it loads and validates configuration, pins
the timezone, builds the logger and data source, composes the module and starts the server.

Express 5 is used because rejected promises from async handlers and middleware reach the
error middleware without an extra wrapper. Middleware order is deliberate and fixed:

1. request logger (correlation id first, so every later failure carries one),
2. JSON body parser with a `100kb` limit,
3. health routes,
4. module routers,
5. terminal not-found handler,
6. central error handler.

### 2. Versioned REST under `/api/v1`

Every business endpoint lives under `/api/v1`. The pilot exposes:

| Method | Path | Result |
|---|---|---|
| `POST` | `/api/v1/delivery-orders` | `201` with the order and a `Location` header |
| `GET` | `/api/v1/delivery-orders?publicCode=...` | `200` with the tenant's order |
| `GET` | `/api/v1/delivery-orders/:orderId` | `200` with the tenant's order |

The tenant always comes from request context:
`apps/api/src/http/middleware/organization-resolver.ts` reads a UUID from the development
header `x-organization-id`. The header is explicitly temporary and is not an authorization
mechanism: any caller can claim any organization until Fase 1 replaces it with verified JWT
claims (ADR-003). Routes never read an organization from the body, path or query, and the
accepted create body omits `organizationId`.

### 3. OpenAPI 3.1 is the HTTP source of truth

`docs/api/openapi.yaml` (OpenAPI 3.1.0) documents paths, schemas, headers, examples and
errors. It is hand-written in Fase 0 because the surface is small, every endpoint is
reviewed anyway, and code-first generation would add tooling without removing the review
step. Zod remains the runtime validator at the boundary; OpenAPI describes the same
contract for clients and reviewers.

The spec states the Fase 0 limitations in its description: no JWT enforcement yet, the
temporary tenant header, the ISO-8601 timestamp convention and the error envelope. The
`bearerAuth` scheme documents the intended Fase 1 contract without being enforced.

Manual maintenance has a known drift risk. It is contained by HTTP tests that assert
status codes, bodies and headers, and by keeping schemas small. Follow-ups are contract
tests (validate responses against the spec) and shared generated types in
`packages/api-contracts`.

### 4. One error envelope and a central typed-error mapping

Every non-2xx API response except the health probes uses:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable message",
    "details": {},
    "correlationId": "c0ffee00-0000-4000-8000-000000000000"
  }
}
```

`details` is optional and only carries safe structured context (for validation, field
paths and messages). Raw request bodies, internal error messages and dependency error
texts are never copied into it. `correlationId` always equals the `x-request-id` response
header.

`apps/api/src/http/middleware/error-handler.ts` maps typed errors centrally:

| Condition | Status | Code | Notes |
|---|---|---|---|
| Runtime validation (Zod / typed validation error) | `400` | Module code | `details.issues[]` with field paths |
| Malformed JSON body | `400` | `INVALID_JSON` | Warning log; raw body not logged |
| Body over the limit | `413` | `PAYLOAD_TOO_LARGE` | Warning log |
| Not found | `404` | Module code | Missing resource in the caller's organization |
| Forbidden (cross-organization resource) | `404` | Not-found code | Enumeration-safe: response is indistinguishable from an unknown id; the real reason is a warning log |
| Invariant / conflict (for example duplicate public code) | `409` | Module code | Safe details only |
| Missing/invalid temporary organization header | `401` | `ORGANIZATION_REQUIRED` / `ORGANIZATION_INVALID` | Development adapter only; disappears in Fase 1 |
| Unknown route | `404` | `ROUTE_NOT_FOUND` | Same envelope and correlation id |
| Anything unexpected | `500` | `INTERNAL_ERROR` | Generic message; stack and cause only in the error log |

Body-parser errors are normalized rather than leaked: Express exposes their type, not a
domain error. Domain errors keep their own classes and never match on message strings.

### 5. Health endpoints are documented exceptions

`/healthz` and `/readyz` report dependency state to an orchestrator, not a client error,
so they return status documents instead of the error envelope:

| Endpoint | Success | Failure | Semantics |
|---|---|---|---|
| `/healthz` | `200 {"status":"ok"}` | Unreachable process | Liveness only; never touches PostgreSQL |
| `/readyz` | `200 {"status":"ready","checks":{"database":"up"}}` | `503 {"status":"not_ready","checks":{"database":"down"}}` | Runs `SELECT 1`; probe error details stay in logs |

Neither endpoint requires tenant context. The API starts before the database is reachable
and retries initialization lazily, so readiness can recover without a restart. The
container healthcheck uses `/healthz`; Compose uses the PostgreSQL `pg_isready` healthcheck
to gate the API and the migrations job.

## Consequences

**Positive**

- Clients get one predictable error shape, including a correlation id they can quote.
- Cross-tenant probes cannot distinguish "forbidden" from "does not exist".
- The HTTP contract is reviewable in git, and runtime validation reuses the application's
  own command/query schemas.
- The Express app is testable without a database because it receives composed ports.
- Health semantics are separated from business errors, so orchestrators are not forced to
  parse an error envelope to decide readiness.

**Negative / trade-offs**

- Hand-written OpenAPI can drift from the implementation; only tests and review protect it
  today.
- Error mapping is a central list that must grow with every new typed error.
- The temporary organization header is insecure by design and must be removed, not
  forgotten, in Fase 1.
- `/api/v1` is fixed now; a breaking contract change needs a new version or an explicit
  compatibility plan.

**Follow-ups**

- Replace `organizationResolver` with JWT authentication and authorization in Fase 1
  (ADR-003).
- Add contract tests or a response validator against `docs/api/openapi.yaml`.
- Add CORS, security headers and rate limiting with the Fase 1 security scope.
- Define pagination/filtering and the versioning policy before the order list endpoint
  grows.
- Generate or share client types in `packages/api-contracts` once the web client consumes
  the API.
