# ADR-006: Docker images, Compose environments and the MinIO decision

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Engineering, architecture plan v0.2; MinIO image choice ratified by the user
- **Supersedes:** none

## Context

The architecture plan requires Docker Compose for development and demo (section 2),
multi-stage images running as non-root, healthchecks with readiness-aware `depends_on`,
persistent PostgreSQL volumes, migrations as a separate job and secrets outside the
repository (section 9). Fase 0 must deliver a stack an operator can start with one command
and a demo variant that cannot drift from it by copy-paste.

The demo also needs S3-compatible object storage for future delivery evidence. The
established `minio/minio` image is no longer publicly pullable, so the object-storage
service needs an explicit, pinned substitute.

## Decision

### 1. Images are built from the repository root

Both Dockerfiles build with the repository root as context because the npm workspace
lockfile, shared `tsconfig` and `packages/api-contracts` live there. `.dockerignore`
excludes `.git`, `node_modules`, build/test output, `.env` variants, logs and the `odd/`
planning workspace, so local artifacts and secrets never enter the build context.

| Image | Dockerfile | Base | Runtime user | Port | Healthcheck |
|---|---|---|---|---|---|
| `erp-logistic-api` | `apps/api/Dockerfile` | `node:22-alpine` | `node` | `3000` | `wget /healthz` |
| `erp-logistic-web` | `apps/web/Dockerfile` | `nginx:alpine` | `nginx` (uid 101) | `8080` | `wget /healthz` |
| `erp-logistic-migrations` | `apps/api/Dockerfile` | `node:22-alpine` | `node` | none | none |

The API image is multi-stage: a `deps` stage copies only workspace manifests and runs
`npm ci`, then a `runtime` stage copies sources and migrations over the installed
dependencies. The `tzdata` package is installed explicitly because Alpine (musl) ignores
`TZ=America/Lima` without it — the container would silently run in UTC. The API still runs
through `tsx` in the runtime stage; a compiled `tsc` build and a `node dist` entry point are
a follow-up, tracked as a temporary bridge rather than presented as a production build.

The web image is a single-stage `nginx:alpine` image because the placeholder has no build
step yet. It replaces the default configuration with one that runs entirely as the
unprivileged `nginx` user (ports below 1024 need root), listens on `8080`, keeps runtime
state under `/tmp`, writes access/error logs to the container streams and serves
`apps/web/public`. When Vite arrives, the web Dockerfile gains a build stage without
changing the runtime contract.

### 2. `docker-compose.yml` is the development stack

| Service | Image / build | Persistence | Readiness |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | named `postgres-data` | `pg_isready`; server and log timezone set to America/Lima |
| `minio` | `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` | named `minio-data` | `curl /minio/health/live` |
| `api` | build from `apps/api/Dockerfile` | none | `depends_on postgres: service_healthy`; `/readyz` reports database state |
| `web` | build from `apps/web/Dockerfile` | none | local `/healthz`; `depends_on api` |
| `migrations` | build from `apps/api/Dockerfile` | none | `depends_on postgres: service_healthy`; `restart: "no"` |

`DATABASE_URL` is derived inside Compose from `POSTGRES_USER`, `POSTGRES_PASSWORD` and
`POSTGRES_DB`, so the credentials cannot drift between services. `API_PORT` stays `3000`
inside the network; only host ports are configurable. The migrations job runs
`npm run migration:run` from `/app/apps/api` and exits. It is never `restart: always`: a
loop would hide a failed schema change.

The `migrations` service reuses the API Dockerfile but Compose assigns it a distinct image
tag (`erp-logistic-migrations`). Building only `api` therefore leaves the migrations image
stale. Operators must run `docker compose build` (all services) or name `migrations`
explicitly, and rebuild after Dockerfile or source changes; `docker compose up` alone does
not rebuild an existing image.

### 3. The demo is an overlay, not a fork

`docker-compose.demo.yml` uses Compose `include:` (requires Compose >= 2.20) to include the
development file, then changes only demo concerns: its own project name
(`erp-logistic-demo`, hence its own image tags), `restart: always` for long-running
services, resource limits for PostgreSQL, MinIO and the API, and `restart: "no"` retained
for migrations. Editing one file therefore cannot silently diverge from the other.

The demo starts with **empty tables**. The Lima seed dataset is not implemented yet; adding
a one-shot `seed` service after `migrations` is a documented follow-up, not a hidden
behavior.

The plan mentions `development`, `test` and `demo` profiles. Fase 0 implements this as the
default development project plus a demo overlay file. There is no dedicated test Compose
file: integration tests run against the development PostgreSQL (or the CI service
container) when `DATABASE_URL` is set and skip cleanly otherwise. That is the honest state
of the test environment, not a missing gate.

### 4. Configuration and secrets

- Every Compose value uses `${VAR:-default}` interpolation, so `docker compose config`
  works without an env file; `.env.example` documents the variables.
- Defaults are throwaway local values only (`change-me-local-only`). Real deployments
  inject secrets from outside the repository.
- `.env` and `.env.*` are git-ignored and Docker-ignored, so secrets are neither committed
  nor baked into an image layer.
- Images and CI workflows contain no credentials. The CI PostgreSQL password is a
  throwaway value scoped to an ephemeral job.

### 5. Healthchecks and startup order

- `api` starts its HTTP server before PostgreSQL is reachable. `/healthz` answers
  immediately; `/readyz` returns `503` and retries lazily until `SELECT 1` succeeds, so a
  database restart does not require an API restart (ADR-004).
- Compose gates `api` and `migrations` on the PostgreSQL healthcheck, not on container
  start order.
- `web` depends on the API container but does not wait for readiness; the placeholder makes
  no API calls.
- The API image healthcheck deliberately fails if `/healthz` is missing, rather than
  tolerating a broken image.
- `migrations` is one-shot in both stacks.

### 6. MinIO image decision

`minio/minio` is no longer publicly pullable: Docker Hub returns `404`, `quay.io` returns
`401`, verified on 2026-10-26. The demo therefore pins the community fork ratified by the
user:

```yaml
image: pgsty/minio:RELEASE.2026-08-04T00-00-00Z
```

| Aspect | Decision |
|---|---|
| Source | `pgsty/minio`, a community build published by pgsty |
| Version | exact release tag, never `latest` |
| Why it fits | MinIO-compatible S3 API, and the image ships `curl`/`mc`, which the healthcheck uses |
| Scope | demo and local object storage for evidence metadata only; PostgreSQL never stores binaries |
| Risks | third-party supply chain and tag availability; no vendor support |
| Mitigation | pin the exact tag, keep evidence storage behind the `EvidenceObjectStorage` port, and revisit before any production use |

This is a pragmatic, reversible substitution, not a re-platforming decision. If the
official image returns, or the fork stops publishing, only the Compose image reference
changes; application code depends on the S3 contract, not on the image.

### 7. Deliberately out of scope

- Registry publishing and image signing.
- A compiled API runtime (the `tsx` bridge is temporary).
- TLS, reverse proxy and HTTPS termination for local/demo.
- Demo seeds, reproducible reset and fictional-data policy.
- Backups and restore drills before real customer data.
- PostGIS, Redis, `gps-simulator` and a dedicated test Compose profile.
- Resource limits in the development stack (they exist only in the demo overlay).

## Consequences

**Positive**

- One command builds and starts a reproducible development stack; the demo cannot drift
  from it.
- Images run unprivileged and expose explicit health endpoints.
- PostgreSQL data and MinIO objects survive container recreation through named volumes.
- Migrations are deterministic, one-shot and never run on API boot.
- Secrets stay in `.env` or the deployment platform, never in images or git.

**Negative / trade-offs**

- Two image tags share one Dockerfile, so a partial build can leave migrations stale; this
  is documented and CI builds all services.
- The API image ships development tooling (`tsx`, dev dependencies) until the compiled
  runtime lands, which increases image size and attack surface.
- The demo's MinIO substitute carries unverified-by-vendor supply-chain risk.
- Healthchecks add startup time, and a cold `npm ci` build is slow without a registry cache.
- The development stack has no TLS; it must not be exposed beyond localhost.

**Follow-ups**

- Replace the `tsx` runtime with a compiled, production-only dependency image.
- Add the demo seed job and a reproducible reset procedure.
- Publish images to a registry with digest pinning and vulnerability scanning.
- Decide the production object-storage provider and MinIO long-term replacement.
- Add backup/restore automation before operating with real customer data.
