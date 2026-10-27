# Data model — `identity-and-access`

Three tables back the module: `organizations` (tenant root), `users` (identity) and
`refresh_tokens` (server-side session state). All identifiers are UUIDs, all instants are
`timestamptz`, and only hashes of secrets are stored.

## Quick path

1. Apply migrations (migration 2 backfills organizations before adding the FK):

   ```bash
   POSTGRES_PORT=5434 docker compose up -d postgres
   DATABASE_URL=postgres://erp_logistic:change-me-local-only@localhost:5434/erp_logistic \
     npm run migration:run -w apps/api
   ```

2. Confirm the backfill:

   ```sql
   SELECT id, name FROM organizations;
   SELECT conname FROM pg_constraint WHERE conname = 'fk_delivery_orders_organization';
   ```

3. Run the module's integration tests with the same `DATABASE_URL`.

## Domain model

```mermaid
classDiagram
    class Organization {
        +UUID id
        +string name
        +string createdAt
        +create(props) Organization
    }

    class User {
        +UUID id
        +UUID organizationId
        +string email
        +string passwordHash
        +UserRole role
        +UserStatus status
        +string createdAt
        +create(props) User
    }

    class StoredRefreshToken {
        +UUID id
        +UUID userId
        +UUID organizationId
        +UUID familyId
        +string tokenHash
        +string issuedAt
        +string expiresAt
        +string|null revokedAt
    }

    Organization "1" --> "0..*" User
    User "1" --> "0..*" StoredRefreshToken
```

`StoredRefreshToken` is an application contract (`application/ports/RefreshTokenStore.ts`),
not a domain aggregate: it is session infrastructure whose lifecycle is entirely driven by
the rotation use case. Exposing it as a domain entity would add an aggregate with no
business behavior.

### Enumerations

| Type | Values |
|---|---|
| `UserRole` | `ADMIN`, `DISPATCHER`, `DRIVER` |
| `UserStatus` | `active`, `disabled` |

Both are stored as `varchar` with a check constraint and mapped to TypeScript unions in the
persistence layer. Domain and DTOs expose the union, never a database string.

## Persistence tables

### `organizations`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | PK `pk_organizations` |
| `name` | `varchar(120)` | no | Trimmed by the domain; `chk_organizations_name` requires 2–120 non-blank characters |
| `created_at` | `timestamptz` | no | Supplied by `Clock` through the use case |

### `users`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | PK `pk_users` |
| `organization_id` | `uuid` | no | FK `fk_users_organization` → `organizations(id)`, `ON DELETE RESTRICT` |
| `email` | `varchar(254)` | no | Lowercased; `chk_users_email` enforces `email = lower(email)` |
| `password_hash` | `varchar(255)` | no | Argon2id encoded hash; never selected into a DTO |
| `role` | `varchar(20)` | no | `chk_users_role` |
| `status` | `varchar(20)` | no | Default `active`; `chk_users_status` |
| `created_at` | `timestamptz` | no | Supplied by `Clock` |

Indexes and constraints:

- `uq_users_organization_email (organization_id, email)` — the per-tenant uniqueness boundary.
- `idx_users_organization_id (organization_id)` — tenant scans and FK checks.
- `RESTRICT` on organization delete: deleting a tenant must not silently orphan users.

### `refresh_tokens`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | no | PK `pk_refresh_tokens`; also the token row id used by `revokeOne` |
| `user_id` | `uuid` | no | FK `fk_refresh_tokens_user` → `users(id)`, `ON DELETE CASCADE` |
| `organization_id` | `uuid` | no | FK `fk_refresh_tokens_organization` → `organizations(id)`, `ON DELETE CASCADE` |
| `token_hash` | `varchar(64)` | no | SHA-256 hex of the opaque token; unique |
| `family_id` | `uuid` | no | Device-session chain; stable across rotations |
| `issued_at` | `timestamptz` | no | Clock instant of issuance |
| `expires_at` | `timestamptz` | no | `issued_at + 7 days`; `chk_refresh_tokens_expiry` requires it to be later |
| `revoked_at` | `timestamptz` | yes | `NULL` while usable; set once, never cleared |

Indexes and constraints:

- `uq_refresh_tokens_token_hash (token_hash)` — lookup is by hash, never by raw token.
- `idx_refresh_tokens_family_id (family_id)` — one UPDATE revokes a whole device chain.
- `idx_refresh_tokens_user_id (user_id)` — future "revoke all sessions for this user".
- Cascades from users/organizations keep deleted tenants from leaving live sessions behind.

Raw refresh tokens, passwords and hashes never appear in logs, DTOs or error details.

## Delivery orders relationship and migration backfill

`delivery_orders.organization_id` existed before organizations did, so migration 2 performs
three ordered steps:

1. Create `organizations`, `users` and `refresh_tokens`.
2. Insert one placeholder organization per **distinct** existing
   `delivery_orders.organization_id`, named `Organization <first 8 characters>`.
3. Add `fk_delivery_orders_organization` with `ON DELETE RESTRICT`.

Without step 2 the FK would fail on existing rows. The backfill is idempotent in practice
because a migration runs once; `DISTINCT` collapses multiple orders that share a tenant. The
placeholder name is deliberately recognizable so a real organization can be renamed later.

Rollback (`down`) drops the FK first, then `refresh_tokens`, `users` and `organizations`.
The backfilled rows disappear with the table; the orders they referenced remain, so running
`up` again recreates the same placeholder names.

The delivery-orders TypeORM entity mirrors the FK with an infrastructure-only `@ManyToOne`
whose target is the string `"OrganizationEntity"`. That keeps `migration:generate` aligned
with the database without importing another module's entity class (ADR-001 rule 6).

## Migration and test evidence

| Check | Where |
|---|---|
| Repositories round-trip, tenant scoping, unique email | `infrastructure/persistence/identity-typeorm.integration.test.ts` |
| Backfill + FK on a pre-populated `delivery_orders` table, and rollback | `infrastructure/persistence/identity-migration.integration.test.ts` (isolated throwaway schema) |
| Password hashing, token claims/algorithm pinning | `tests/argon2-password-hasher.test.ts`, `tests/jwt-token-service.test.ts` |
| Rotation, reuse, expiry, role reload | `tests/refresh-session.test.ts` |

Integration tests skip with a logged reason when `DATABASE_URL` is absent or unreachable; a
reachable database without the migrated schema fails, because that is a defect rather than
an environment limitation.
