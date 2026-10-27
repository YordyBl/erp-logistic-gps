# `identity-and-access` module

The module owns tenants, platform users and authenticated sessions: who exists, which
organization they belong to, how they prove identity, and how a device session is rotated
or revoked. It is the authorization foundation every other module will consume.

**Status:** domain, application, the five core use cases, Argon2id/jose adapters,
PostgreSQL persistence and migration 2 are implemented and tested. HTTP routes, JWT
middleware, cookies and rate limiting belong to the HTTP task (T2); this module exposes no
Express code.

## Quick path

1. Read the identity policy in [business-rules.md](business-rules.md).
2. Inspect the ports and adapters in [architecture.md](architecture.md).
3. Check tables, indexes and the backfill in [data-model.md](data-model.md).
4. Read the rationale and follow-ups in [decisions.md](decisions.md).
5. Run the module tests from the repository root:

   ```bash
   env -u DATABASE_URL npm test                        # unit suite; integration skips
   DATABASE_URL=postgres://erp_logistic:change-me-local-only@localhost:5432/erp_logistic \
     npm test                                          # unit + PostgreSQL integration
   ```

## Responsibility

| In scope | Out of scope (T2 and later) |
|---|---|
| `Organization` and `User` entities, roles and statuses | Express routes, JWT middleware, `requireRole` guard |
| Password policy and Argon2id hashing | Login rate limiting implementation and shared store |
| ADMIN-only user provisioning | Password reset, invitations by email, user disable/enable use cases |
| Login, refresh rotation with reuse detection, idempotent logout | Refresh cookie flags and set/clear wiring |
| HS256 access tokens with an explicit claim set | Key rotation, asymmetric keys, JWKS |
| Refresh-token family model and server-side hash storage | Scheduled cleanup of expired rows |
| TypeORM entities and migration 2 (organizations, users, refresh_tokens) | Demo seed and documented demo credentials (T4) |
| Organization backfill for existing `delivery_orders` rows | Corporate-client role (explicitly out of the MVP) |

## Boundaries and dependencies

- Domain code imports only shared pure helpers (`isUuid`, `DomainError`). It never imports
  Zod, TypeORM, jose, argon2 or Express (ADR-001 rule 1).
- Application use cases depend on ports only: `UserRepository`, `OrganizationRepository`,
  `RefreshTokenStore`, `PasswordHasher`, `TokenService`, `Clock`, `IdGenerator`.
- TypeORM lives in `infrastructure/persistence`; jose/argon2/node:crypto live in
  `infrastructure/security`; both are wired in [composition/composition-root.ts](../composition/composition-root.ts).
- No other module imports this module's internals. The only cross-module schema link is the
  `delivery_orders.organization_id` FK, declared in the migration and mirrored by an
  infrastructure-only relation on the delivery-orders entity.

## Ratified roles

| Role | Intended use |
|---|---|
| `ADMIN` | Organization configuration, user provisioning, full operational access |
| `DISPATCHER` | Customers, orders, routes, dispatch and monitoring |
| `DRIVER` | Only the routes and orders assigned to them |

Corporate clients are not an authenticated role in the MVP; they use public tracking only
(architecture plan §11.2).

## Scenarios

| Scenario | Use case | Result |
|---|---|---|
| First organization setup or demo seed | `RegisterOrganizationUseCase` | Organization row created |
| An ADMIN invites a dispatcher | `CreateUserUseCase` | Active user with an Argon2id hash; duplicate email per tenant rejected |
| A valid user signs in | `LoginUseCase` | 15-minute access JWT + 7-day refresh token in a new family |
| A client refreshes | `RefreshSessionUseCase` | Old token revoked, new token in the same family |
| An attacker replays a rotated token | `RefreshSessionUseCase` | Whole family revoked, `RefreshReuseDetectedError` |
| A user logs out | `LogoutUseCase` | Current refresh token revoked; retries are no-ops |

## Code map

```text
identity-and-access/
├── domain/
│   ├── entities/{Organization,User}.ts
│   ├── errors/IdentityError.ts
│   └── policies/{password-policy,session-policy}.ts
├── application/
│   ├── dto/{IdentityDto,AuthSessionDto}.ts
│   ├── ports/{UserRepository,OrganizationRepository,RefreshTokenStore,PasswordHasher,TokenService,Clock,IdGenerator}.ts
│   ├── validation.ts
│   └── use-cases/
│       ├── register-organization/
│       ├── create-user/
│       ├── login/
│       ├── refresh-session/
│       ├── logout/
│       └── shared/create-session.ts
├── infrastructure/
│   ├── persistence/{entities,mappers,repositories,test-database}
│   └── security/{argon2-password-hasher,jwt-token-service}.ts
├── composition/composition-root.ts
├── tests/
└── docs/
```

## Next step

T2 mounts the use cases behind `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`,
`POST /api/v1/auth/logout` and `GET /api/v1/auth/me`, stores the refresh token in the
HttpOnly/Secure/SameSite=Strict cookie and replaces the temporary `x-organization-id`
header. The HTTP contract will live in `docs/api/openapi.yaml` and this module's
`api-contracts.md` when that task lands.
