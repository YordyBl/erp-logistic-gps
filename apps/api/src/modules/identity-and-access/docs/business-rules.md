# Business rules — `identity-and-access`

Identity is invitation-only: an organization exists first, an ADMIN creates every user, and
a session is a short-lived access token plus a rotating refresh secret. The rules below are
the ratified policy (architecture plan §7 and §11) expressed as testable statements.

## Tenancy

| Rule | Enforcement |
|---|---|
| Every user belongs to exactly one organization | `users.organization_id NOT NULL` + FK to `organizations` |
| Emails are unique per organization, not globally | `uq_users_organization_email`; domain lowercases before storage |
| Email lookup during login is tenant-scoped | `UserRepository.findByEmail(organizationId, email)` |
| A caller from another organization is reported as not found | `CreateUserUseCase` returns `UserNotFoundError` for unknown or foreign actors |
| Orders may not reference a nonexistent organization | `fk_delivery_orders_organization` (migration 2) |

Email normalization is trim + lowercase. The database repeats the invariant
(`chk_users_email`), so a row written outside the application cannot create a second
case variant.

## Roles

| Role | MVP scope |
|---|---|
| `ADMIN` | Provision users, configure the organization, full operational read access |
| `DISPATCHER` | Customer accounts, orders, routes, dispatch and monitoring |
| `DRIVER` | Only assigned routes/orders; execute deliveries and report incidents |

- A corporate-client role is **not** part of the MVP.
- `create-user` is ADMIN-only. The actor's role is loaded from storage, never read from a
  JWT claim (ADR-003 §2), so a demotion takes effect on the next request.
- No other role may create users; a non-ADMIN receives `ForbiddenRoleError`.

## User status

| Status | Meaning |
|---|---|
| `active` | Can log in and refresh sessions |
| `disabled` | Rejected at login and at refresh; row is kept for audit |

This milestone has no enable/disable use case. Status is assigned `active` on creation and
can only be changed by a future ADMIN use case plus a migration-safe write path.

## Password policy

| Rule | Value |
|---|---|
| Minimum length | 10 characters |
| Maximum length | 200 characters (request-size guard, still far above any sane password) |
| Character classes | At least one letter (Unicode `\p{L}`) and one digit |
| Not required | Symbols, mixed case, rotation, dictionary checks |

Rationale: administrators create accounts and choose temporary passwords, so the policy
must block obviously weak values without turning the invitation into a puzzle. The rejected
password is never echoed in the error; the error carries stable reason codes instead
(`minimum_length`, `maximum_length`, `letter_required`, `digit_required`, `invalid_type`).

## Login

| Condition | Result |
|---|---|
| Unknown email in the organization | `InvalidCredentialsError` — same message as a wrong password |
| Wrong password | `InvalidCredentialsError` |
| Disabled user | `InvalidCredentialsError` |
| Active user with a matching password | New access JWT + new refresh family |
| Access token lifetime | 15 minutes |
| Refresh token lifetime | 7 days |
| Refresh token format | Opaque 256-bit URL-safe random string, never a JWT |

The identical generic message prevents account enumeration. Details of a rejected login
never include the email, password or hash.

## Refresh rotation and reuse detection

| Situation | Result |
|---|---|
| Hash is not stored | `RefreshNotFoundError`; nothing changes |
| Token already revoked or already rotated | Reuse: `revokeFamily`, then `RefreshReuseDetectedError` |
| Token expired | `InvalidTokenError` with `reason: "expired"`; nothing is rotated |
| Concurrent rotation lost the race | Treated as reuse: family revoked, `RefreshReuseDetectedError` |
| Live token | Old row revoked atomically, new row issued **in the same family** |
| User missing, disabled or organization mismatch | Session rejected with `InvalidTokenError`; mismatch also revokes the family |

Reuse is intentionally aggressive: a stolen token and the legitimate device both lose the
chain and must log in again (ADR-003 §3). Expired tokens are **not** reported as reuse and
are **not** rewritten; cleanup is a separate follow-up.

A new login always starts a new family. Two devices therefore have independent families: a
compromise on one leaves the other signed in.

## Logout

| Situation | Result |
|---|---|
| Live token | Revoked; `{ revoked: true }` |
| Already revoked token | No-op; `{ revoked: false }` |
| Unknown token | No-op; `{ revoked: false }` |
| Other device families | Untouched |

Logout is idempotent so retries and duplicate tabs are harmless. Access tokens remain
technically valid until they expire (at most 15 minutes); this is the accepted stateless
trade-off in ADR-003.

## Organization registration

`register-organization` is a bootstrap path for the demo seed and first-tenant setup, not an
endpoint offered to authenticated admins. It validates a trimmed 2–120 character display
name, assigns a UUID and a clock timestamp, and grants no access by itself. Organization
names are not unique.

## Edge cases

| Case | Behavior |
|---|---|
| Email differs only by case | Same account; normalization happens before lookup and storage |
| Same email in two organizations | Allowed; each is a separate user with its own password hash |
| Duplicate create inside one organization | `EmailAlreadyInUseError`, also translated from PostgreSQL `23505` on a race |
| Weak password on create | `WeakPasswordError`, nothing stored, hash function not called |
| Invalid role/email/UUID | `IdentityValidationError` with safe field paths |
| Refresh token expired exactly at `expiresAt` | Rejected (expiry is inclusive, matching JWT `exp`) |
| Actor belongs to another organization | `UserNotFoundError`, indistinguishable from an unknown actor |
