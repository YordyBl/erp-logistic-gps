# Decisions — `delivery-orders`

| Id | Decision | Status |
|---|---|---|
| DO-001 | Canonical order statuses exclude `failed`; failure lives on the attempt | Accepted |
| DO-002 | Caller supplies `publicCode`; server-side sequences deferred | Accepted, revisit with persistence |
| DO-003 | Cross-organization read throws a distinct forbidden error | Accepted; HTTP maps it to 404 (DO-010) |
| DO-004 | `Package` is a value object of the order aggregate | Accepted |
| DO-005 | Zod validates only at the application boundary | Accepted |
| DO-006 | UUIDv4 for internal ids; UUIDv7 remains pending | Accepted, pending plan §11.9 |
| DO-007 | Events are published in-process through a port; no outbox yet | Accepted for pilot |
| DO-008 | The composition root wires in-memory adapters by default | Accepted for tests/demo |
| DO-009 | `Clock` returns ISO-8601 instants; Lima presentation is an infrastructure concern | Accepted |
| DO-010 | HTTP maps cross-organization reads to 404 with the not-found envelope | Accepted |

## DO-001 — Canonical status vocabulary excludes `failed`

**Context.** The conceptual data model listed a working set that included `failed` and
delegated the canonical vocabulary to this module. The ratified incident policy says every
delivery incident marks the attempt failed and moves the order to `returned` in one
transaction, with no field retries.

**Decision.** The order status set is `created`, `planned`, `assigned`, `in_transit`,
`delivered`, `returned`, `cancelled`. `failed` is the `DeliveryAttempt.status`, not an order
status.

**Why.** Keeping `failed` on the order would create a resting state that implies a field
retry or a pending warehouse decision, contradicting invariant 14. One failure concept lives
on the attempt; the order records the operational consequence (`returned`).

**Consequences.** Consumers must read the attempt to know why a delivery failed. The
conceptual model's working set is superseded by this module for orders, as it explicitly
allows.

## DO-002 — `publicCode` is caller-supplied for the pilot

**Context.** Readable codes are separate from internal UUIDs and unique per organization.
A real sequence needs a database-backed counter or a dedicated generator port; neither
exists before persistence.

**Decision.** The create command requires `publicCode` (3–32 uppercase letters/digits/hyphens,
unique per organization). The use case rejects duplicates through the repository, and the
future database adds a unique constraint.

**Why.** It avoids deriving public codes from UUID fragments (which would leak identifier
material) and avoids inventing a second generator before the persistence model is decided.

**Risks.** A caller can choose an inconvenient or guessable code; codes are not credentials,
so this is acceptable for the demo. Server-side generation is a follow-up when the order
persistence and operator UX are defined.

## DO-003 — Distinct forbidden error for cross-organization reads

**Context.** The conceptual model says cross-organization access should look like "not
found" to avoid confirming that an order exists. The delegated task explicitly requires a
forbidden error so the distinction is testable.

**Decision.** `GetDeliveryOrderUseCase` loads by id without a tenant filter and throws
`DeliveryOrderNotFoundError` or `DeliveryOrderForbiddenError`. The HTTP adapter decides the
wire behavior; Fase 0 maps both to `404` (DO-010).

**Why.** The application layer keeps enough information to make an explicit authorization
decision; HTTP can choose the disclosure policy without re-querying.

**Risk.** A production adapter that returns `403` leaks order existence. This is documented
in `api-contracts.md` and must be resolved in the security review.

## DO-004 — `Package` is a value object

**Context.** The conceptual model gives packages table rows and ids. The task defines
`Package` as an immutable value object inside the aggregate.

**Decision.** The aggregate owns a non-empty, code-unique collection of `Package` value
objects. The persistence adapter will still create `delivery_order_package.id` UUIDs, but
the domain never addresses a package by id in this pilot.

**Why.** Attaching a second identity to an object that cannot exist outside its order adds
complexity without a use case. Delivery attempts and proof of delivery are order-level in the
MVP (data-model invariant note).

**Risk.** Future package-level operations (for example scanned parcel labels) may require
promoting `Package` to an entity with its own id; that change stays inside this module.

## DO-005 — Zod only at the application boundary

**Decision.** Commands and queries are parsed with Zod in their `Command.ts`/`Query.ts`
files. Domain entities and value objects validate with plain TypeScript helpers and throw
`DeliveryOrderValidationError`.

**Why.** ADR-001 rule 1 forbids framework imports in the domain, and rule 8 requires runtime
validation of external input. Keeping both layers gives defense in depth: the boundary
produces good field-level messages; the aggregate cannot be constructed in an invalid state
by another caller.

**Consequence.** Some rules exist twice (for example phone shape and coordinate pairing).
Tests assert both layers so they cannot drift silently.

## DO-006 — UUIDv4 now, UUIDv7 pending

**Decision.** `CryptoIdGenerator` uses `crypto.randomUUID()` (UUIDv4). The domain validates
UUID shape without pinning a version.

**Why.** UUIDv7 improves index locality but the decision is pending in the architecture plan
(§11.9). A single port plus a version-agnostic validator makes the change local.

## DO-007 — In-process events, no outbox yet

**Decision.** `DeliveryOrderCreated` is published through an `EventPublisher` port after the
repository save; the pilot adapter records events in memory.

**Why.** The module needs a typed event now, but event transport guarantees, retry and
replay are pending (plan §11.11). The port prevents use cases from depending on a future
message bus.

**Risk.** A failed publish leaves a stored order without its event. Before another module
consumes this event, an outbox or equivalent transactional mechanism must be added. The
event payload omits recipient PII.

## DO-008 — In-memory composition by default

**Decision.** `createDeliveryOrdersModule()` wires `InMemoryDeliveryOrderRepository`,
`CryptoIdGenerator`, `SystemClock` and `InMemoryEventPublisher` unless overrides are passed.
`createDeliveryOrdersModuleFromDataSource()` swaps in the PostgreSQL adapter for the HTTP
process; the module and its use cases are identical in both wirings.

**Why.** It keeps the pilot runnable and testable without PostgreSQL or Docker. Tests inject
a fixed clock and sequential id generator for determinism.

**Risk.** The in-memory repository has no transactions, durability or unique-constraint
enforcement. It is confined to tests and demos; `apps/api/src/main.ts` uses the TypeORM
adapter.

## DO-009 — ISO-8601 strings from the Clock

**Decision.** `Clock.now()` returns an ISO-8601 instant string. The aggregate validates the
format and stores `createdAt`/`updatedAt` without converting time zones.

**Why.** The ratified convention is America/Lima presentation with instants preserved
(plan §2, data-model conventions). Storing ISO-8601 UTC strings keeps the domain independent
of date libraries; the API/UI will render `-05:00` Lima time, and database `timestamptz`
handles persistence later.

**Risk.** The API keeps UTC instants on the wire and the persistence session plus structured logs
use America/Lima, so a careless client could still display UTC. That is a presentation bug, not a
data-loss bug; the OpenAPI document states the rendering convention explicitly.

## DO-010 — Cross-organization reads return 404 over HTTP

**Context.** DO-003 keeps a distinct forbidden error in the application so the distinction
stays testable. Fase 0 had to choose what the wire exposes; the parent decision is
enumeration safety.

**Decision.** `DeliveryOrderForbiddenError` maps to `404` with code
`DELIVERY_ORDER_NOT_FOUND` and the same message shape as an unknown id
(`Delivery order <id> was not found`). The real `DELIVERY_ORDER_FORBIDDEN` error and the
organization ids are logged at warn level with the correlation id. No delivery-order
endpoint returns `403` for a cross-organization read.

**Why.** A `403` confirms that the order exists in another tenant, which enables enumeration.
The application keeps the distinction for audits and a future authorization policy; HTTP
does not disclose it.

**Consequences / risk.** Operators diagnose tenant mismatches from logs, not responses. Every
new delivery-order read path must reuse the same mapping; the HTTP tests assert that the
cross-organization and unknown-id responses are indistinguishable.
