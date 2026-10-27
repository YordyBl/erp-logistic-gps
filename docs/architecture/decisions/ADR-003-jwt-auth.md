# ADR-003: JWT authentication and authorization policy

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Engineering, architecture plan v0.2 (ratified 2026-10-26)
- **Supersedes:** none

## Context

The platform serves three authenticated audiences and one public audience:

- **ADMIN** and **DISPATCHER** users work from the web console.
- **DRIVER** users work from a mobile web view while executing their route.
- **Recipients** are unauthenticated and follow exactly one order through a public link.
- Live updates reach the console and driver view over WebSocket.

The MVP has no external identity provider. Sessions must survive page reloads, be
revocable server-side after logout or token theft, and never allow one organization to
read another's data. The architecture plan ratified a concrete token policy (sections 7
and 11.7); this ADR records it together with the implementation rules needed to apply it
consistently.

## Decision

### 1. Token model

| Token | Format | Lifetime | Storage |
|---|---|---|---|
| Access token | JWT | 15 minutes | Client memory (web); never a long-lived cookie |
| Refresh token | Opaque random string | 7 days | Server-side hash + `HttpOnly` cookie on the web client |
| Public tracking token | Opaque random string | Configured expiry, revocable | Hash server-side; delivered in the public link |

The access token is stateless and short-lived. The refresh token is opaque, high-entropy
(CSPRNG, at least 256 bits), and stored server-side only as a hash. It is not a JWT.
The public tracking token is also opaque and is never a session JWT nor the order code.

### 2. Access token signing and validation

- The signing algorithm is fixed in configuration and pinned during verification. A
  single expected algorithm is allowed; any other value — including `none`, a swapped
  `alg`, or an unexpected key — is rejected before claims are read.
- The demo default is HS256 with a secret of at least 256 bits from the environment.
  ES256/EdDSA is preferred once key management exists; the verification code must not
  need changes beyond configuration.
- Issuer (`iss`) and audience (`aud`) are configured per environment and must match
  exactly.
- Every access token carries and validates `iss`, `aud`, `exp`, `nbf`, `sub` (user id)
  and `jti` (unique token id, used for audit correlation). `iat` is set at issuance.
- `sub`, `organizationId` and `role` claims are routing/UX hints only. Every use case
  reloads membership and role from the database and re-checks resource ownership. A
  token issued before a role change must not grant the old role.
- Clock skew tolerance is small and configurable (for example 30 seconds). Expired,
  not-yet-valid (`nbf`) and malformed tokens are rejected with `401` and a generic
  error; validation details are logged without the token value.
- Access tokens are short-lived and not individually revocable. Logout therefore does
  not invalidate an already issued access token; it expires within 15 minutes. This is
  an accepted trade-off of the stateless design.

### 3. Refresh rotation, revocation and reuse detection

- Every successful refresh issues a new refresh token and marks the presented one as
  rotated. Rotation is atomic: a token can be consumed exactly once.
- The server stores only a hash of the refresh token (peppered SHA-256 is sufficient
  because the token is high-entropy; the raw value never persists) together with the
  user, organization, issued/expiry timestamps and the rotation chain.
- Presenting an already-rotated or revoked refresh token is treated as reuse: the whole
  token family (the device session chain) is revoked and the user must log in again.
- Refresh tokens expire after 7 days from issuance. Expired tokens are rejected and
  reported as an expired session, not as an invalid token.
- Logout revokes the refresh token of the current device session only. Other devices stay
  signed in. An ADMIN-initiated session revoke (for example a compromised account) may
  revoke every active chain for that user.
- A scheduled cleanup removes expired and long-revoked token rows.

### 4. Web cookie policy

- The refresh token is delivered in a cookie with `HttpOnly`, `Secure` and
  `SameSite=Strict`; the path is scoped to the auth endpoints.
- No additional CSRF token is required in the MVP because the refresh endpoint is a
  `POST`, the cookie is `SameSite=Strict`, and CORS is restricted to the known web
  origin. This makes `SameSite=Strict` a load-bearing control: it must not be relaxed
  without adding CSRF protection.
- Local development runs over HTTPS (or a same-site localhost setup) rather than
  weakening the cookie flags.
- The access token is never stored in `localStorage` or a non-`HttpOnly` cookie on the
  web client; it is kept in memory and re-obtained through the refresh endpoint.

### 5. Passwords and login protection

- Passwords are hashed with Argon2id, per-user salt, parameters tuned to the target
  hardware (the OWASP baseline is the starting point). Hashes are never logged or
  returned by any endpoint.
- Login is rate limited per IP address and per account, with temporary blocking and
  generic error messages that do not reveal whether an email exists. Rate limits and
  lockout windows are configuration, finalized with the broader security policy
  (architecture plan section 11.17).
- Password reset and user invitation follow the ratified identity decision: users are
  created by an ADMIN invitation (architecture plan section 11.2), not by self
  registration.

### 6. Roles and authorization

MVP roles: `ADMIN`, `DISPATCHER`, `DRIVER`. A corporate customer role is a future
authenticated role and is out of scope for the MVP.

| Role | Scope |
|---|---|
| ADMIN | Organization configuration, user invitations/roles, full operational read access, evidence access |
| DISPATCHER | Customer accounts, orders, routes, dispatch, monitoring, evidence review |
| DRIVER | Only the routes/orders assigned to them: execute deliveries, confirm deliveries, report incidents, attach evidence |

Authorization is enforced in three checks for every use case, not only in middleware:

1. The caller is authenticated (valid access token).
2. The caller belongs to the organization that owns the target resource.
3. The caller's role and resource ownership permit the action (for a DRIVER, the order
   belongs to a route currently assigned to them).

Resources outside the caller's organization are reported as not found, not as
forbidden, to avoid leaking the existence of other tenants' data. Role changes take
effect on the next request because membership is reloaded from the database.

### 7. Public tracking

- Each order can be tracked with an opaque token of at least 128 bits (256 recommended)
  generated from a CSPRNG, URL-safe encoded, with server-side expiry and revocation.
- The token is not a JWT and is not the order code. Order codes are readable and
  guessable; tracking tokens are secrets.
- Tracking is scoped to exactly one order. The response is a whitelisted projection: no
  other orders, stops, customers, drivers' personal data or internal evidence.
- Incident photos are not exposed by default; only evidence explicitly permitted for
  public view is shown.
- Tracking endpoints are rate limited and do not allow enumeration. Revocation takes
  effect immediately.
- Anyone with the link can view the order, so links are treated as bearer secrets: they
  are not placed in referrers, analytics or logs.

### 8. Real-time subscriptions

- WebSocket connections authenticate during the handshake with a valid access token.
  Unauthenticated connections are closed.
- Every subscription is authorized against organization, route and order scope and the
  caller's role. A DRIVER subscribes only to their own assignments; a DISPATCHER only to
  their organization.
- The server never broadcasts across organizations and never sends a payload to a
  connection that is not authorized for that resource.
- When the access token expires, the connection is closed and the client reconnects with
  a fresh token; authorization is re-evaluated on reconnect.

### 9. Transport and observability

- HTTPS is required in every deployed environment. HSTS is enabled where TLS terminates.
- CORS uses an explicit origin allow-list; credentials are allowed only for the known web
  origin.
- Responses include security headers (frame ancestors, content type sniffing, referrer
  policy, and a content security policy for the web app).
- Logs redact passwords, hashes, tokens, cookies, `Authorization` headers and recipient
  PII (phone, email, full address). Structured logs carry a correlation id per request;
  security-relevant events (login success/failure, refresh reuse, logout, role changes,
  public token access) are audited.

## Consequences

**Positive**

- Short-lived access tokens limit the damage of a leaked token, while server-side refresh
  state enables real revocation after logout or theft.
- Rotation with reuse detection turns a stolen refresh token into a detectable event and
  invalidates the attacker's and victim's chain.
- `SameSite=Strict` plus a restricted CORS allow-list removes the need for a CSRF token
  in the MVP without an extra client-side mechanism.
- Authorization checks reloaded per use case keep role and tenant boundaries correct
  even with stale tokens.

**Negative / trade-offs**

- Refresh state must be stored, rotated atomically and cleaned up; a lost rotation race
  can log a user out.
- Reuse detection is intentionally aggressive: a client that retries a refresh with an
  old token loses the session.
- Access tokens cannot be revoked before expiry; a compromised access token is valid for
  up to 15 minutes.
- `SameSite=Strict` and `Secure` constrain local development and require the web client
  to be served same-site with the API.
- Opaque tracking links are bearer secrets: anyone with the link sees the order until it
  expires or is revoked.

**Follow-ups**

- Define key rotation and (if asymmetric signing is adopted) JWKS publication.
- Add a shared rate-limit store (Redis) before horizontal scaling; in-process limits are
  not sufficient across replicas.
- Revisit CSRF protection if the web client and API are ever served cross-site.
- Define evidence download authorization and signed-URL TTLs together with the
  `delivery-execution` module (architecture plan section 11.19).
