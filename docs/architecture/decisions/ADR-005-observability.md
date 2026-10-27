# ADR-005: Structured logging, correlation ids and observability baseline

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Engineering, architecture plan v0.2
- **Supersedes:** none

## Context

A request can fail in the HTTP adapter, in a use case, or in PostgreSQL, and the operator
sees only a response. Without a shared identifier and structured records, diagnosing a
reported failure means correlating unstructured text across processes. The architecture
plan requires structured logs, correlation ids and a consistent error format (section
11.12), plus America/Lima in logs (section 2). ADR-003 additionally requires that logs
never expose tokens, credentials or recipient personal data.

Fase 0 has no metrics backend, no tracing collector and no log aggregation service. The
observability baseline must therefore be useful with the tools already present: container
stdout and a JSON-capable log viewer.

## Decision

### 1. pino writes JSON logs to stdout

`apps/api/src/http/logger.ts` creates a `pino` logger; `pino-http` writes one request
record per HTTP request. Records are newline-delimited JSON on stdout/stderr, so Docker,
Compose and any aggregator can consume them without a file layout. Log level comes from
`LOG_LEVEL` (default `info`; `trace` through `fatal`, plus `silent`) and is validated at
boot. Pretty-printing is a local pipe concern, not an application dependency.

### 2. Correlation id lifecycle

| Step | Behavior |
|---|---|
| Incoming header | `x-request-id` is honored only when it matches `^[A-Za-z0-9._:-]{1,128}$` |
| Invalid or missing | The API generates a UUIDv4 instead of copying an arbitrary client string |
| Request scope | Stored once in `res.locals` through the typed accessor in `request-context.ts` |
| Response | Always echoed as the `x-request-id` header |
| Error body | Always repeated as `error.correlationId` |
| Logs | pino-http attaches it as the request id; error and readiness-failure records include `correlationId` explicitly |

The id is a tracing aid, not an authentication or authorization signal: a client can choose
its own value, and the API only guarantees that logs and the response agree.

### 3. Redaction and data minimization

The logger redacts these paths to `[Redacted]`:

- `req.headers.authorization`
- `req.headers.cookie`
- `req.headers["x-api-key"]`
- `req.headers["x-auth-token"]`
- `res.headers["set-cookie"]`

Request bodies are not logged at all. That is the primary protection for recipient names,
phones, addresses and future evidence metadata. Validation errors log only field paths and
messages, never the rejected values. Error records include the error object and stack for
unexpected failures, but domain errors are constructed under the rule that details carry no
secrets or raw personal data (`DomainError` documents this constraint). Tokens, password
hashes, refresh hashes and public tracking secrets never enter a log statement.

Redaction is deny-by-path, so new credential-bearing headers require an explicit addition
to the list. Reviewers must treat a new sensitive field as a logging decision, not an
afterthought.

### 4. America/Lima timestamps

Every record uses a custom pino timestamp: `YYYY-MM-DDTHH:mm:ss.SSS-05:00`, formatted with
the IANA zone `America/Lima`. The offset is rendered explicitly so a reader does not need to
know the container timezone. Lima has no daylight saving time, so the offset is constant,
but the formatter still uses `Intl` with the zone rather than assuming `-05:00` forever.

At boot, `applyRuntimeTimezone` pins `process.env.TZ` to America/Lima. This aligns `Date`
formatting in libraries and local development with the database session timezone (ADR-007).
Log time and stored instants remain the same moment; only presentation changes.

### 5. What is logged today

| Level | Events |
|---|---|
| `info` | API listening (port, environment, timezone), database initialized, graceful shutdown with signal |
| Request records | Method, path, status, duration and request id from pino-http |
| `warn` | Readiness probe failure, cross-organization access denial, malformed or oversized bodies |
| `error` | Unexpected handler/startup/shutdown failures with the error object |
| `fatal` | Reserved; no current call site |

Status-changing business events and security audit records (login, refresh reuse, role
changes, public tracking access) arrive with Fase 1 and ADR-003. Logs are not yet an audit
trail and must not be treated as one.

### 6. Deliberately not included yet

Metrics, distributed tracing, log sampling and alerting are future work. The likely path is
OpenTelemetry traces and metrics exported to a collector, with the existing correlation id
propagated as the trace/span attribute. Until then, `/healthz` and `/readyz` are the
observability surface for orchestrators, and JSON logs are the diagnostic surface for
humans.

## Consequences

**Positive**

- One identifier links a client report, the response header, the error body and every log
  line of that request.
- JSON records are queryable by field without parsing free text.
- Log timestamps are readable in Lima time without knowing the container timezone.
- Credentials and recipient data have an explicit, testable exclusion path.

**Negative / trade-offs**

- JSON is verbose for a developer reading a terminal; pretty-printing is external.
- Redaction is path-based and must be maintained as headers and fields are added.
- No metrics or traces yet: latency, error rate and dependency health require log queries.
- Log volume and retention are delegated to the deployment platform; nothing rotates or
  caps logs inside the application.

**Follow-ups**

- Add OpenTelemetry tracing/metrics and propagate the correlation id as a trace attribute.
- Define retention, access control and alerting for production logs.
- Add security audit events with Fase 1 authentication.
- Revisit redaction when evidence uploads and public tracking add new sensitive fields.
