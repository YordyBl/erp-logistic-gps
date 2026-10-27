# Business rules — `delivery-orders`

An order is accepted only when it has a recipient, a deliverable address and at least one
package, and only inside one organization. Statuses describe the order's dispatch
lifecycle; delivery failure is recorded on its attempt and sends the order back to the
warehouse.

## Status vocabulary

| Status | Meaning | Terminal |
|---|---|---|
| `created` | Order exists and is not planned into a route yet. Initial state. | No |
| `planned` | A dispatcher placed the order on a planned route. | No |
| `assigned` | Route, driver and vehicle are assigned; the order is queued for the run. | No |
| `in_transit` | The driver started the route containing this order. | No |
| `delivered` | A successful delivery attempt confirmed this order. | Yes |
| `returned` | A delivery incident failed the attempt and the order came back to the warehouse. | Yes |
| `cancelled` | The order was cancelled before delivery. | Yes |

`failed` is not an order status in this module. Failure belongs to
`DeliveryAttempt.status`; see the incident rule below.

## Allowed transitions

| From | To | Driver of the change (future modules) |
|---|---|---|
| `created` | `planned`, `cancelled` | `delivery-routes`, order cancellation |
| `planned` | `assigned`, `cancelled` | `dispatch`, order cancellation |
| `assigned` | `in_transit`, `cancelled` | `delivery-execution` (start route), cancellation |
| `in_transit` | `delivered`, `returned` | `delivery-execution` (confirm delivery, report incident) |
| `delivered`, `returned`, `cancelled` | — | Terminal; no transition allowed |

The policy is declared in
[policies/DeliveryOrderStatusPolicy.ts](../domain/policies/DeliveryOrderStatusPolicy.ts).
This pilot does not implement a status-transition use case. `DeliveryOrder.status` is
read-only and always starts at `created`, so no caller can change it outside an explicit
use-case decision. `confirm-delivery` and `report-delivery-incident` belong to the future
`delivery-execution` module.

## Ratified incident rule

> Any registered delivery incident marks the attempt as failed and returns the order to the
> warehouse (`returned`). There are no field retries in the MVP: a new delivery is a new
> dispatcher decision. "Recipient did not answer" uses the `other` category.

Consequences for this module:

- The order-side transition is `in_transit → returned`.
- The attempt-side outcome is `failed`, recorded on the `DeliveryAttempt` aggregate owned by
  `delivery-execution`.
- Both writes must commit in one transaction when that flow is implemented (invariant 14).
- `returned` is terminal for the order. Re-dispatching means a new order or a deliberate
  dispatcher decision in a later phase, never a field retry.

## Invariants

| Invariant | Enforced by | Error |
|---|---|---|
| Every order belongs to exactly one organization | Command scope plus `organizationId` on the aggregate | Validation / forbidden |
| An order has at least one package | `DeliveryOrder.create` and the Zod boundary | Invariant / validation |
| Package codes are unique inside one order | `DeliveryOrder.create` | Invariant |
| `publicCode` is unique per organization | Create use case lookup plus future database constraint | Invariant |
| Internal ids are UUIDs; public codes are separate and readable | `DeliveryOrder.create` and `IdGenerator` | Validation |
| Status only changes through an explicit use case | Read-only status field; no transition method in this pilot | Compile-time |
| Timestamps are ISO-8601 instants | `Clock` contract plus aggregate validation | Validation |
| Personal data is not copied into domain events | `DeliveryOrderCreated` payload | Review |

## Validation

### Recipient

| Field | Rule |
|---|---|
| `name` | Trimmed, 1–120 characters |
| `phone` | Trimmed, 6–20 characters, digits/space/parentheses/hyphen, optional leading `+`, 6–15 digits |

### Delivery address

| Field | Rule |
|---|---|
| `addressLine` | Trimmed, 5–200 characters |
| `district` | Trimmed, 2–80 characters. Free text until the Lima geographic catalogue is ratified |
| `latitude` / `longitude` | Optional pair. Both or neither; latitude −90..90; longitude −180..180 |

### Package

| Field | Rule |
|---|---|
| `code` | Trimmed, 1–40 characters, letters/digits/hyphen/underscore, starts with a letter or digit; stored uppercase |
| `description` | Trimmed, 1–200 characters |
| `weightKg` | Optional finite number greater than 0 and at most 1000 |

### Order

| Field | Rule |
|---|---|
| `organizationId` | UUID. In HTTP it must come from validated JWT claims, never the request body |
| `publicCode` | 3–32 characters of letters/digits/separating hyphens; normalized uppercase; unique per organization |
| `packages` | 1–100 items; codes unique inside the order |

## Edge cases

| Case | Behaviour |
|---|---|
| Zero packages | Rejected at the Zod boundary and again by the aggregate; nothing stored, no event |
| Two packages with the same code, different case | Normalized to uppercase, then rejected as duplicates |
| Lowercase public code | Normalized to uppercase before validation |
| Only latitude or only longitude | Rejected by both Zod and `DeliveryAddress` |
| Duplicate public code in the same organization | Invariant error; first order remains, second event is not published |
| Same public code in another organization | Allowed; uniqueness is per organization |
| Unknown order id | Not-found error |
| Order owned by another organization | Forbidden error; no order data returned |
| Malformed command/query | Validation error with field paths; raw input is not echoed because it may contain PII |
| Clock returns a non-ISO value | Aggregate rejects the timestamp; this is a programming error in the adapter |

## Examples

### Accepted order

```json
{
  "organizationId": "11111111-1111-4111-8111-111111111111",
  "publicCode": "ord-2026-0001",
  "recipient": { "name": "Ana Torres", "phone": "+51 987 654 321" },
  "deliveryAddress": {
    "addressLine": "Av. Javier Prado Este 1234",
    "district": "San Borja"
  },
  "packages": [
    { "code": "pkg-001", "description": "Sealed box", "weightKg": 2.5 },
    { "code": "pkg-002", "description": "Document envelope" }
  ]
}
```

Result: `publicCode` is `ORD-2026-0001`, packages are `PKG-001` and `PKG-002`, status is
`created`, and one `DeliveryOrderCreated` event is published.

### Rejected order

A command with `packages: []` returns `DELIVERY_ORDER_INVALID_INPUT` from the Zod boundary.
Constructing the aggregate directly with no packages returns
`DELIVERY_ORDER_INVARIANT_VIOLATION`. In both cases the repository stays unchanged.

## Time conventions

Instants come from the `Clock` as ISO-8601 strings. UTC (`Z`) is used for storage and API
transport; the ratified convention is to present them in America/Lima (`-05:00`, no daylight
saving) in UI, logs and audit. Enforcing the zone at the database and HTTP serialization
layers is infrastructure work for a later phase.
