# ADR-008: Authentication implementation

- **Status:** Accepted
- **Date:** 2026-10-27
- **Deciders:** Engineering, architecture plan v0.2 (ratified 2026-10-26)
- **Supersedes:** none

## Context

ADR-003 ratified the authentication policy: 15-minute access tokens, 7-day rotating refresh
tokens, reuse detection that revokes the whole family, Argon2id password hashing, an
environment-driven cookie policy and login rate limiting. The policy leaves the concrete
implementation choices open.

Phase 1 implements that policy in the `identity-and-access` module and the HTTP layer.
Several decisions are easy to get subtly wrong and are not visible from the endpoints, so
they are recorded here: the algorithm allowlist, the exact hashing parameters, the
revocation primitive behind rotation, the development/production cookie split and the
bounds of the in-memory limiter. Anything that needs a migration or a deployment change is
listed as a follow-up instead of being guessed.

## Decision

### 1. Access tokens are HS256 JWTs verified with `jose` and an explicit algorithm allowlist

`apps/api/src/modules/identity-and-access/infrastructure/security/jwt-token-service.ts`
issues and verifies access tokens with `jose` (`SignJWT` / `jwtVerify`).

| Concern | Decision |
|---|---|
| Algorithm | `HS256`, pinned through `algorithms: ['HS256']` on verification. `none` and header-swapped algorithms are rejected before claims are read. |
| Required claims | `iss`, `aud`, `exp`, `nbf`, `sub`, `jti`, `iat`. |
| Claims read | `sub` (user id), `organizationId`, `role`; `sub`, `jti` and `organizationId` must be UUIDs and `role` must be one of the known roles. |
| Issuer / audience | Exactly matched against configuration (`JWT_ISSUER`, `JWT_AUDIENCE`; defaults `erp-logistic-api` / `erp-logistic-web`). |
| Clock skew | 30 seconds (`clockTolerance`), so small clock drift does not reject a valid token. |
| Secret | `JWT_SECRET`, minimum 32 characters, no default in code. Configuration fails at boot when it is missing or short. |
| Lifetime | 15 minutes by default (`ACCESS_TOKEN_TTL_MINUTES`), supplied by the session policy. |

Verification failures become `InvalidTokenError` with a `reason` (`expired`,
`invalid_signature`, `algorithm_not_allowed`, ...) and a generic 401; the token value is
never logged, echoed or copied into the response. The middleware then reloads the user from
storage on every request: a deleted, disabled or moved account, or an organization that no
longer matches the claim, is `401 AUTH_SESSION_INVALID` instead of a trusted claim. Role
checks read the stored role, never the claim.

### 2. Passwords use Argon2id with fixed OWASP-baseline parameters

`Argon2PasswordHasher` (`argon2` package) fixes the parameters in code:

| Parameter | Value |
|---|---|
| Variant | Argon2id |
| Memory | 19 MiB (`memoryCost: 19_456` KiB) |
| Iterations | 2 (`timeCost`) |
| Parallelism | 1 lane |

They are not environment-driven: a weaker deployment value would silently weaken every
stored hash, and changing the parameters needs a rehash plan (`argon2.needsRehash`) that
does not exist yet. `verify` returns `false` for a malformed hash so a corrupted row is a
credential failure instead of a 500.

The login use case also carries a dummy hash (one Argon2id hash of 32 random bytes computed
once at composition). Unknown email, wrong password and a disabled account all verify
against a real hash, so the failure paths cost the same as a valid one and the response time
does not reveal whether the account exists (T1 review finding R1-001).

### 3. Refresh tokens rotate inside a family, and reuse revokes the family

- The refresh token is 32 random bytes from `crypto.randomBytes`, base64url-encoded (256
  bits), never a JWT. Only its SHA-256 hex digest is stored; the unique index on that column
  is the lookup key, which a keyed HMAC would complicate once a pepper rotates (module
  ADR-005).
- Every login starts a new family. Every refresh revokes the presented row and inserts its
  successor in the same family.
- Revocation is a single conditional `UPDATE ... WHERE revoked_at IS NULL`
  (`RefreshTokenTypeOrmStore.revokeOne`). That statement is the single-winner primitive: of
  two concurrent refreshes of the same token exactly one succeeds, and the loser is treated
  as reuse.
- Presenting an already revoked token revokes the whole family and returns `401
  IDENTITY_REFRESH_REUSE_DETECTED`. An expired token is **not** reuse: it is rejected with
  `IDENTITY_INVALID_TOKEN` (`reason: "expired"`) and nothing is rotated.
- After a successful rotation the user is reloaded; a disabled user or an organization
  mismatch revokes the family.
- Logout revokes only the presented token (other devices stay signed in) and is idempotent:
  an unknown or already revoked token is a successful no-op. Access tokens are stateless and
  expire within 15 minutes; logout does not revoke them.

The accepted failure mode is revoke-then-insert: a crash between the two writes logs the
device out instead of leaving a token valid twice.

### 4. Cookie flags are fixed except `Secure`, which is environment-driven

| Attribute | Value |
|---|---|
| Name | `erp_refresh_token` |
| `HttpOnly` | Always. The raw refresh token never reaches JavaScript and is never echoed in JSON. |
| `SameSite` | `Strict` in every environment. |
| `Path` | `/api/v1/auth`, so the browser does not attach the secret to business endpoints. |
| `Secure` | `COOKIE_SECURE`: defaults to `true`; local plain-HTTP development must opt out explicitly. |
| `Max-Age` | Refresh-token lifetime from the session policy (604800 seconds by default). |

No separate CSRF token is used in the MVP. `SameSite=Strict` plus the `POST` refresh
endpoint is the control that replaces it, so it must not be relaxed without adding CSRF
protection. Every rejected refresh and every logout clears the cookie with `Max-Age=0` and
the same path/flags.

### 5. Login rate limiting is in-memory for the MVP and bounded

`InMemoryLoginRateLimiter` sits in the HTTP login route:

| Concern | Decision |
|---|---|
| Key | Client IP plus the normalized email (`ip:email`), so one client cannot lock out a different account and a victim's quota cannot be exhausted from another address. |
| Counting | Only `InvalidCredentialsError` records a failure; a successful login does not consume the window. |
| Window | `LOGIN_RATE_LIMIT_MAX_ATTEMPTS` (default 10) failures inside `LOGIN_RATE_LIMIT_WINDOW_SECONDS` (default 900). |
| Response | `429 AUTH_RATE_LIMITED` with a `Retry-After` header and `details.retryAfterSeconds` (whole seconds, minimum 1). |
| Bounds | At most 100 000 tracked windows; expired entries are swept and, when the cap is still reached, the oldest entry is evicted. Keys longer than 512 characters are never indexed. |
| Scope | Process-local: it resets on restart and each replica counts separately. |

The bounds are a deliberate correction to a review finding: without a cap, an attacker
could grow the map without limit. Per-key blocking is best effort once the cap is reached,
which is the accepted MVP trade-off.

### 6. Configuration is validated once at composition

`loadAuthConfig` (`apps/api/src/config/config.ts`) validates `JWT_SECRET`, issuer, audience,
token lifetimes, `COOKIE_SECURE` and the rate-limit values at boot. The composition root
receives the validated object; no module or route reads `process.env` directly. Secrets have
no defaults in code, and the only defaults are the throwaway values used by local Compose.

## Consequences

**Positive**

- The algorithm allowlist, claim requirements and storage reload make a stolen or stale
  token hard to abuse and impossible to extend beyond its 15-minute life.
- Rotation with reuse detection is atomic at the database level, so two clients racing on
  one refresh token cannot both continue the chain.
- Real Argon2id hashes are produced by the same hasher the API uses, including by the demo
  seed, so seeded users can log in immediately.
- The limiter protects the login endpoint without a new dependency, and its size is bounded
  under credential stuffing.

**Negative / trade-offs**

- HS256 requires every verifier to hold the signing secret; asymmetric signing with JWKS is
  a later change and needs key management.
- Refresh rotation is not transactional across revoke and insert: a crash between them logs
  the device out.
- The limiter is per process: horizontal scaling dilutes it, and a restart forgets the
  current windows.
- Clearing the refresh cookie on every rejection (including an infrastructure 500) turns a
  transient failure into a device logout. That is accepted for the MVP because it fails
  closed.
- Argon2id parameters are frozen in code; changing them requires the rehash path that is
  still missing.

**Follow-ups**

- Peppered HMAC for refresh hashes with key versioning (module ADR-005).
- `argon2.needsRehash` and a rehash-on-login migration path.
- Shared (Redis) rate limiting and a per-IP ceiling before horizontal scaling; today the
  limiter key collapses to the email when a proxy hides the client IP.
- Scheduled cleanup for expired and long-revoked refresh rows.
- Access-token denylist or key rotation (JWKS), only if the 15-minute stateless trade-off
  stops being acceptable.

## References

- [ADR-003](ADR-003-jwt-auth.md) — ratified JWT, cookie, RBAC and password policy.
- [ADR-007](ADR-007-identifiers-and-time.md) — UUID and instant conventions used by claims
  and stored token rows.
- `apps/api/src/modules/identity-and-access/docs/decisions.md` — module-level decisions
  (ADR-003 session model, ADR-005 refresh hashing, ADR-008 configuration split).
- `docs/api/openapi.yaml` — published auth surface, cookie notes and error codes.
