# Decisions — `identity-and-access`

Local architecture decision records for this module. They are numbered (`ADR-00N`) and
section-numbered because source comments cite them, for example `ADR-003 §3`. Numbers are
stable: a superseded decision gets a new ADR instead of an edit that moves sections.

| ADR | Decision | Status |
|---|---|---|
| [001](#adr-001--module-boundary-rules) | Hexagonal boundary rules, including the cross-module FK link | Accepted |
| [002](#adr-002--persistence-and-transaction-scope) | Persistence conventions, migration ordering and transaction scope | Accepted |
| [003](#adr-003--session-and-credential-model) | Access/refresh token model and credential handling | Accepted |
| [004](#adr-004--tenant-context-is-an-explicit-command-input) | Tenant id is explicit input, never inferred from a claim | Accepted |
| [005](#adr-005--refresh-secrets-are-sha-256-hashed-without-a-pepper-yet) | Refresh secret hashing and the pepper follow-up | Accepted |
| [006](#adr-006--validation-at-the-boundary-policy-in-explicit-functions) | Zod at the edge, policy in named functions, typed errors | Accepted |
| [007](#adr-007--shared-primitives-clock-ids-and-instants) | Clock, id generation and timestamp ownership | Accepted |
| [008](#adr-008--separate-loadauthconfig-from-appconfig) | Separate `loadAuthConfig` from `AppConfig` | Accepted |
| [009](#adr-009--http-contract-deferred-to-t2) | No HTTP contract in this milestone | Accepted |

## ADR-001 — Module boundary rules

The monolith is modular: identity is a slice with its own domain, application and adapters,
and other modules may consume it only through composition or DTOs.

| Rule | Decision |
|---|---|
| 1 | Domain code imports only shared pure helpers (`isUuid`, `DomainError`). No Zod, TypeORM, jose, argon2 or Express. |
| 2 | Application use cases depend on ports and never construct adapters; only composition wires concrete classes. |
| 3 | Framework types stay in `infrastructure/`. Persistence rows are mapped to domain entities by explicit mappers. |
| 4 | Other modules do not import this module's entities, repositories or internals. |
| 5 | Cryptographic libraries live only in `infrastructure/security/`; no secret handling leaks into domain or application. |
| 6 | A schema-level cross-module link is declared in migration SQL, and the owning entity mirrors it with a string target (`@ManyToOne('OrganizationEntity')`) plus a structural interface instead of importing the other module's class. |

Rule 1 keeps domain tests dependency-free and prevents validation rules from diverging
between layers. Rule 6 keeps `migration:generate` aligned with foreign keys without creating
a compile-time dependency between `delivery-orders` and `identity-and-access`.

## ADR-002 — Persistence and transaction scope

1. **Entities, mappers, repositories.** A TypeORM entity represents a table, a mapper converts
   between row and domain object, and a repository implements an application port. Database
   constraints repeat domain invariants (email lowercase, role/status checks, positive
   expiry) so a write that bypasses the application still cannot store an invalid row.
2. **Repositories return domain entities, never persistence rows.** Use cases therefore never
   see TypeORM column names, `Date` conversions or nullable database fields.
3. **Migration 2 is ordered and defensive.** It creates `organizations`, `users` and
   `refresh_tokens`, inserts one placeholder organization per distinct existing
   `delivery_orders.organization_id` named `Organization <first 8 characters>`, and only then
   adds `fk_delivery_orders_organization` with `ON DELETE RESTRICT`. The backfill precedes the
   constraint because pre-existing orders have no organization row yet. `down` drops the FK
   first, then the tables, so rollback never leaves a dangling constraint.
4. **Transaction scope is one statement.** Session rotation revokes the presented row with a
   single conditional `UPDATE ... WHERE revoked_at IS NULL`; that statement is the
   single-winner primitive, so two concurrent refreshes cannot both succeed. Coordinated
   multi-row writes are deliberately out of scope here: when another module needs them, a
   unit-of-work port is the extension point. The accepted failure mode is revoke-then-insert:
   a crash between the two writes logs the user out instead of leaving a token valid twice.

## ADR-003 — Session and credential model

1. **Access token shape.** HS256 JWT with `sub`, `organizationId`, `role`, `jti`, `iat`,
   `nbf`, `exp`, `iss` and `aud`. Lifetime is 15 minutes; issuer and audience are verified on
   every request.
2. **Stateless access plus fresh authorization.** The access token is not checked against a
   session table, so it stays valid until `exp` (at most 15 minutes) even after logout. The
   signing algorithm is pinned to an allowlist (`HS256` only), so `none` or a header-swapped
   algorithm is rejected before claims are read. Authorization decisions that matter
   (`create-user`) reload the actor's role and organization from storage and ignore the role
   claim, so a demotion or cross-tenant forged claim takes effect immediately.
3. **Opaque refresh tokens with family rotation.** The refresh token is a 256-bit URL-safe
   random string, never a JWT. Only its SHA-256 hash is stored. Each login starts a new
   family; every rotation revokes the presented row and inserts its successor in the same
   family. Presenting an already revoked token is treated as reuse: the whole family is
   revoked and `RefreshReuseDetectedError` is raised. An expired token is **not** reuse and is
   not rewritten; it is reported as `InvalidTokenError` with `reason: "expired"`.
4. **The refresh secret is handed to the transport once.** `AuthSessionDto` is the only place
   the raw value exists; it is never read back from storage, logged or echoed. Cookie flags
   and set/clear behavior belong to the HTTP adapter (T2).
5. **Argon2id and generic credential errors.** Passwords use Argon2id with 19 MiB, two
   iterations and one lane (OWASP interactive baseline). Unknown email, wrong password and
   disabled user all return the same `InvalidCredentialsError` message, and no error or log
   contains the email, password or hash. Parameters are fixed in code so a weak environment
   value cannot silently weaken stored hashes; changing them requires `needsRehash` handling.
6. **Tenant-scoped identity lookups.** `findByEmail` takes `organizationId` because emails are
   unique per tenant. `findById` is unscoped so a use case can distinguish a missing actor from
   a foreign-tenant actor and answer both as not found, which prevents cross-tenant account
   enumeration during provisioning.

## ADR-004 — Tenant context is an explicit command input

`LoginCommand` requires `organizationId` because the email lookup is tenant-scoped; the HTTP
adapter resolves it from the tenant context (today the `x-organization-id` header) and never
from user-supplied body claims. `CreateUserCommand` carries both `organizationId` and
`actorUserId`: the use case loads the actor, rejects a foreign-tenant or unknown actor with
`UserNotFoundError`, and only then checks that the actor is an `ADMIN`.

`RefreshSessionCommand` and `LogoutCommand` take only the raw refresh token: the stored token
row already carries `organizationId` and `userId`, and a token whose user moved to another
organization is rejected (and its family revoked on refresh). This keeps tenant context out of
the untrusted payload while still binding every session to one tenant.

## ADR-005 — Refresh secrets are SHA-256 hashed, without a pepper yet

Refresh tokens are 256-bit random values, so a plain SHA-256 digest is sufficient to make the
stored value useless for authentication: there is no low-entropy guess space to attack. The
hash is also the lookup key (`uq_refresh_tokens_token_hash`), which a keyed HMAC would
complicate once the pepper rotates.

The trade-off is that a database dump plus read access to the application code still does not
yield usable tokens, but a leaked pepper would add defense in depth. A peppered HMAC with
versioned keys is a deliberate follow-up, together with key rotation. Note that `.env.example`
still names the earlier `JWT_ACCESS_SECRET` and `JWT_REFRESH_TOKEN_PEPPER` variables; the
implemented configuration reads `JWT_SECRET` and does not use a pepper. That file is outside
this task's edit surfaces and must be updated with the T2 environment work.

## ADR-006 — Validation at the boundary, policy in explicit functions

Commands are `z.strictObject` schemas, so unknown keys are rejected instead of silently
ignored. A Zod failure becomes `IdentityValidationError` with safe `path`/`message` issues, not
a raw library error. Format rules (UUID, email, role) live in Zod; the password policy lives in
`domain/policies/password-policy.ts` and raises `WeakPasswordError` with stable reason codes
(`minimum_length`, `maximum_length`, `letter_required`, `digit_required`, `invalid_type`).

Reason codes exist because the rejected value must never be echoed: an administrator pasting a
password into a ticket should not see it reflected in an error payload or log. The hash
function is not called for a rejected password.

## ADR-007 — Shared primitives: clock, ids and instants

1. **Clock port.** Use cases receive `Clock.now(): string` and never call `Date.now()`, which
   makes expiry, rotation and session issuance deterministic in tests.
2. **Id generator port.** `IdGenerator.nextId()` is backed by `crypto.randomUUID()` (UUIDv4).
   Choosing UUIDv7 later is a composition swap and does not touch domain or application code.
3. **Instants are ISO-8601 strings.** Domain and application carry strings; persistence
   adapters convert to `Date` for `timestamptz` columns and back on read.
4. **Use cases own timestamps.** `created_at`, `issued_at`, `expires_at` and `revoked_at` are
   supplied by the use case through the clock, never by database defaults, so the stored
   instant matches the value the domain reasoned about. Database checks still guard shape
   (for example expiry after issuance).

## ADR-008 — Separate `loadAuthConfig` from `AppConfig`

`AppConfig` (`loadConfig`) is the process-wide configuration consumed by existing tests and
the delivery-orders composition. Auth settings were added as a separate `AuthConfig` plus
`loadAuthConfig(env)` in `apps/api/src/config/config.ts` rather than as new required fields on
`AppConfig`: the existing `config.test.ts` asserts the exact shape of `loadConfig({})` and is
outside this task's edit surfaces, so extending `AppConfig` would have forced an unrelated test
change.

`loadAuthConfig` validates `JWT_SECRET` (minimum 32 characters, no default), issuer, audience,
token lifetimes, `COOKIE_SECURE` and the login rate-limit placeholders. Composition receives the
validated object and never reads `process.env` itself. The cost is two loaders that T2 must call
together when it mounts the HTTP adapter.

## ADR-009 — HTTP contract deferred to T2

This milestone ships no routes, middleware, cookies or `docs/api-contracts.md`. The transport
decisions that shape the contract — cookie flags and CSRF strategy, rate-limit storage,
`GET /auth/me` shape, replacement of `x-organization-id` — belong to the HTTP task, and
freezing an OpenAPI document before them would encode guesses as commitments.

The use case inputs and outputs are already transport-shaped (`AuthSessionDto`, typed errors),
so T2 maps them without changing the application layer. `docs/README.md` records the intended
endpoints and the cookie policy as the starting point for that contract.

## Open follow-ups

| Topic | Why it is deferred |
|---|---|
| Peppered HMAC for refresh hashes and key versioning | ADR-005; needs a rotation plan and configuration surface |
| `argon2.needsRehash` and a parameter-migration path | ADR-003 §5; requires a rehash-on-login write path |
| Cleanup job for expired/revoked refresh rows | Not needed for correctness; table growth is the only cost |
| Access-token denylist or key rotation (JWKS) | Contradicts the 15-minute stateless trade-off unless requirements change |
| Login rate limiting | Placeholders exist in `AuthConfig`; enforcement needs a shared store (T2) |
| Delivery-orders integration tests seeding organizations | Existing tests insert random organization ids, so the new FK rejects them; the fix belongs to that module's test fixture |
