# ADR-007: Identifiers and time

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Engineering, architecture plan v0.2 (ratified 2026-10-26)
- **Supersedes:** none

## Context

Two conventions are easy to apply inconsistently and expensive to reverse once data
exists: how records are identified, and how time is stored and presented. The architecture
plan requires internal UUID identifiers with separate readable public codes (rule 12),
leaves UUIDv4 versus UUIDv7 open (section 11.9), and ratifies America/Lima across database,
API, UI, logs and audit (section 2). An early pilot cannot postpone the decision: the
`delivery_orders` table already stores UUID primary keys, per-organization public codes and
`timestamptz` columns.

## Decision

### 1. Internal identifiers are UUIDv4 behind a generator port

Every aggregate and business table uses an RFC 4122 UUID primary key. Today the value comes
from `crypto.randomUUID()` wrapped in `generateUuidV4()` (`apps/api/src/shared/ids.ts`), and
use cases receive it through the `IdGenerator` port. Nothing in the domain calls the crypto
API directly, so a future version change is a composition-root change, not an aggregate
change.

Why UUIDv4 now:

| Property | Consequence |
|---|---|
| No dependency, native in Node 22 | No supply-chain or implementation risk in Fase 0 |
| 122 random bits | Not guessable, safe as an internal id that may appear in URLs |
| No time or sequence embedded | No creation-time leak; no cross-node coordination |
| Fixed size `uuid` column | Same storage and index shape as any other UUID version |

The validator accepts versions 1-8 as long as the RFC 4122 variant matches. That is
deliberate: a later UUIDv7 rollout must not require rewriting existing rows or relaxing
validation for new ones. It is not a claim that identifiers are typed by version.

### 2. Public codes are separate, human-readable and tenant-scoped

Internal ids are never exposed as the business key. The pilot uses `public_code`
(`varchar(32)`) with:

- application normalization to uppercase before validation,
- format `^[A-Z0-9]+(?:-[A-Z0-9]+)*$` (letters, digits and separating hyphens),
- database check `chk_delivery_orders_public_code`,
- per-organization uniqueness `uq_delivery_orders_organization_public_code`.

Package codes are unique per order (`uq_delivery_order_packages_order_code`), not globally.
The operator supplies the public code in Fase 0; server-side sequences are a follow-up.
Public codes are not secrets and grant no access by themselves.

The use case checks uniqueness before saving, but that check is a fast path, not the
correctness boundary. If two concurrent creates pass the check, PostgreSQL rejects the
second insert with error `23505` on `uq_delivery_orders_organization_public_code`.
`DeliveryOrderTypeOrmRepository` translates that driver error into the same
`DeliveryOrderInvariantError` the pre-check raises, so the central HTTP error handler
returns `409` with the conflict envelope instead of a generic `500`.

Tracking tokens are a third, separate concept: opaque, high-entropy bearer secrets stored
as hashes with expiry and revocation (ADR-003). A public code is never used as a tracking
token, and a tracking token is never used as an internal id.

### 3. UUIDv7 is the documented future upgrade

UUIDv7 is preferred when the cost is justified because it is time-ordered: new rows insert
at the end of the B-tree instead of scattering across it, and ids sort by creation time
without a separate sequence. That matters as tables and write volume grow.

It is not adopted in Fase 0 because:

- Node 22 has no native UUIDv7 generator; it needs a reviewed dependency or a carefully
  tested monotonic implementation.
- The first 48 bits expose creation time, a small information leak that must be accepted
  deliberately.
- Clock rollback and same-millisecond monotonicity are implementation details that need
  tests, not assumptions.
- The pilot has no demonstrated index-locality problem yet.

Migration strategy when ratified:

1. Change the generator implementation (or add a v7 generator) behind `IdGenerator`; keep
   the `uuid` column type and all foreign keys unchanged.
2. Emit v7 only for new rows. Mixed v4/v7 tables are valid; validators already accept both.
3. Do not backfill existing primary keys. A backfill would touch every foreign key for no
   business benefit and would rewrite immutable identity.
4. Rely on UUIDs only as identity. Ordering and pagination use `created_at` plus a stable
   tiebreaker, never the id's lexical order.
5. Add tests for version/variant shape, uniqueness and monotonicity within one process
   before enabling it.

### 4. Instants are `timestamptz` and the session timezone is America/Lima

- Every business timestamp is PostgreSQL `timestamptz`, which stores an absolute instant.
  Naive `timestamp` columns are not used for instants.
- The PostgreSQL server runs with `timezone=America/Lima` and
  `log_timezone=America/Lima` in Compose, and the TypeORM data source pins every connection
  with `-c timezone=America/Lima`. A connection made outside Compose still gets the
  ratified session timezone.
- Session timezone only controls rendering; it never shifts the stored instant.
- The pilot tables do not use database `now()` defaults for business timestamps.
  `created_at` and `updated_at` are supplied by the use case through the `Clock` port, so a
  test can control time and the write path has one source of truth.
- `updated_at` is maintained by the write path, not by a trigger yet. The create path sets
  both timestamps from the same clock reading; an update path must keep doing so. A trigger
  or optimistic-concurrency column is a follow-up when concurrent updates become real.

### 5. The HTTP boundary uses ISO-8601 instants

`SystemClock` returns `Date.toISOString()` (`YYYY-MM-DDTHH:mm:ss.sssZ`). `DeliveryOrderDto`
exposes `createdAt` and `updatedAt` as those ISO-8601 strings. The contract is an instant
with an explicit designator; clients render it in Lima time. A naive local string
(`2026-10-26 10:00:00`) is never sent over the API.

Lima is UTC-5 year-round with no daylight saving time, so the same instant renders as
`...T10:00:00.000-05:00` in Lima. The offset is presentation, not a different value. UI
formatting belongs to the web client and must use the IANA zone `America/Lima`, not a
hard-coded offset copied into components.

### 6. Logs and audit render Lima time

pino uses a custom timestamp that formats with `Intl` and the IANA zone `America/Lima`,
rendering an explicit `-05:00` offset (ADR-005). The process timezone is pinned at boot.
Log timestamps and API instants therefore describe the same moment in the convention the
plan requires.

### 7. Calendar dates are a separate, later concern

Delivery windows (AM/PM), "today" in Lima and route dates are calendar semantics, not
instants. When they arrive they must be computed explicitly in `America/Lima`; a
`timestamptz` is not a date, and a date column must not be interpreted as midnight UTC.
This ADR fixes instants and identifiers now and leaves calendar-date modeling to the
module that needs it.

## Consequences

**Positive**

- Identity is unpredictable, dependency-free and independent of database sequences.
- Public codes stay readable for operators without becoming authorization secrets.
- UUIDv7 can be adopted incrementally without schema or foreign-key changes.
- Stored time is unambiguous; only rendering depends on a timezone.
- API, database and log conventions agree on one zone and one instant model.

**Negative / trade-offs**

- UUIDv4 primary keys have poorer index locality than time-ordered ids at scale.
- Random ids are longer and less readable than integers in logs and support tooling.
- Public-code uniqueness costs a lookup plus a constraint; a create race relies on the
  database constraint, whose violation is translated into the same typed invariant error
  and therefore the same `409` response.
- Hand-maintained `updated_at` can be forgotten by a new write path until a trigger lands.
- Lima's fixed offset is convenient but must not be copied to a future multi-timezone
  deployment.

**Follow-ups**

- Ratify and schedule UUIDv7 (architecture plan section 11.9) and add monotonicity tests.
- Add server-side public-code sequences or a documented operator convention.
- Add an `updated_at` trigger or optimistic concurrency when concurrent updates exist.
- Model delivery windows and calendar dates in the module that owns them.
- Revisit PostGIS and spatial columns separately (ADR-002 section 5).
