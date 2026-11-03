# API contracts — `delivery-orders`

> **Status: implemented (Phase 0; auth updated in Phase 1).** The Express adapter lives in
> `apps/api/src/http`. The OpenAPI 3.1 document at `docs/api/openapi.yaml` is the
> source of truth for HTTP; this page explains the conventions, decisions and
> error semantics that an OpenAPI reader cannot infer.

## Quick path

1. Authenticate with `Authorization: Bearer <access-token>` (obtained from
   `POST /api/v1/auth/login`); the tenant comes from the verified JWT claims.
2. `POST /api/v1/delivery-orders` → `201` with the created resource and a `Location` header.
3. Read it back with `GET /api/v1/delivery-orders/{orderId}` or
   `GET /api/v1/delivery-orders?publicCode=...`.
4. Cancel a not-yet-in-transit order with `POST /api/v1/delivery-orders/{orderId}/cancel`.
   Read its retained status history with `GET /api/v1/delivery-orders/{orderId}/history`.
5. Read failures from the single error envelope; a cross-organization read is an
   indistinguishable `404`.

## Conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1` |
| Tenancy | The caller's organization comes only from the verified JWT claims set by the shared `authenticate` middleware (ADR-003). The organization is never accepted from the body, path or query. |
| Authentication | JWT access tokens (15 min, HS256 via `jose`, pinned algorithm and required claims) with RBAC roles (`ADMIN`, `DISPATCHER`, `DRIVER`). A missing or invalid token → `401`. |
| Catalog access | Customer catalog and general delivery-order reads and writes require `ADMIN` or `DISPATCHER`; `DRIVER` uses assigned-route and delivery-execution endpoints. |
| Content type | `application/json; charset=utf-8` |
| Ids | Internal UUIDs in paths. Public codes are lookup/display values, never credentials. |
| Timestamps | ISO-8601 instants on the wire (UTC `Z`, as produced by the clock and `timestamptz` persistence). Clients render America/Lima (`-05:00`). |
| Correlation | Every response carries `x-request-id`. A safe incoming value is honored; otherwise the API generates one. The same value appears as `correlationId` in error bodies. |
| Validation | Zod at the HTTP boundary reuses the application command/query schemas. Unknown body and query keys are rejected (`400`). |
| Logging | Request method, URL, headers, status and timing are logged as structured JSON. Bodies are never logged; `authorization` and `cookie` headers are redacted. Log timestamps use the Lima offset. |

## Endpoints

### `POST /api/v1/delivery-orders`

Creates one order in the caller's organization. Only `ADMIN` and `DISPATCHER` may create orders; other authenticated roles receive `403`.

Required headers: `authorization: Bearer <access-token>`. Optional: `x-request-id`, `content-type: application/json`.

Request body — `organizationId` is not part of the accepted shape and is rejected as an unknown key:

```json
{
  "customerId": "55555555-5555-4555-8555-555555555551",
  "publicCode": "ORD-2026-0001",
  "recipient": {
    "name": "Ana Torres",
    "phone": "+51 987 654 321"
  },
  "deliveryAddress": {
    "addressLine": "Av. Javier Prado Este 1234",
    "district": "San Borja",
    "latitude": -12.0975,
    "longitude": -77.0023
  },
  "packages": [
    { "code": "PKG-001", "description": "Sealed box", "weightKg": 2.5 },
    { "code": "PKG-002", "description": "Document envelope" }
  ]
}
```

`customerId` is required and must identify an active customer in the caller's organization. Unknown or cross-organization customer IDs return the tenant-scoped customer-not-found response; inactive customers return `409 CUSTOMER_INACTIVE`.

Notes:

- `publicCode` is normalized to uppercase and unique per organization. Server-side
  sequence generation remains a pending decision (DO-002).
- `deliveryAddress.latitude` and `longitude` are optional but must appear together.
- `weightKg` is optional; the response materializes it as `null` when absent.

Response `201 Created`:

```json
{
  "data": {
    "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "organizationId": "11111111-1111-4111-8111-111111111111",
    "customerId": "55555555-5555-4555-8555-555555555551",
    "publicCode": "ORD-2026-0001",
    "status": "created",
    "recipient": { "name": "Ana Torres", "phone": "+51 987 654 321" },
    "deliveryAddress": {
      "addressLine": "Av. Javier Prado Este 1234",
      "district": "San Borja",
      "latitude": -12.0975,
      "longitude": -77.0023
    },
    "packages": [
      { "code": "PKG-001", "description": "Sealed box", "weightKg": 2.5 },
      { "code": "PKG-002", "description": "Document envelope", "weightKg": null }
    ],
    "createdAt": "2026-10-26T20:00:00.000Z",
    "updatedAt": "2026-10-26T20:00:00.000Z"
  }
}
```

Headers: `Location: /api/v1/delivery-orders/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
and `x-request-id`.

| Status | When |
|---|---|
| `201` | Order created |
| `400` | Invalid body (field issues in `details.issues`) or malformed JSON |
| `401` | Missing/invalid access token |
| `409` | `publicCode` already used in the organization |
| `500` | Unexpected failure; generic message, no internals |

### `POST /api/v1/delivery-orders/import`

Imports CSV (`text/csv`) or XLSX (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) as raw request bodies. The endpoint is restricted to `ADMIN` and `DISPATCHER`, limits uploads to 5 MB and 5,000 data rows, and derives the organization only from the authenticated request. The file must not contain a tenant identifier.

The `Orders` worksheet and CSV header row use the same columns:

```text
customerCode,timeWindow,publicCode,recipientName,recipientPhone,addressLine,district,latitude,longitude,packageCode,packageDescription,packageWeightKg
```

One row represents one package. Repeat all order-level values for every row with the same `publicCode`. `latitude`, `longitude`, and `packageWeightKg` are optional columns/values; coordinates must be supplied together. A customer is matched by `customerCode` within the caller's organization and must be active. Unknown, missing required, duplicate, or blank headers reject the entire file before writes. For a valid header, all rows of each order group are validated together: one invalid row rejects that entire order, reports its source row numbers and issues, and does not prevent unrelated valid orders from being imported. Orders are persisted with all packages through the existing aggregate create use case.

Response `200 OK`:

```json
{
  "data": {
    "importedOrders": [],
    "rejectedOrders": [
      {
        "publicCode": "ORD-2026-0002",
        "rowNumbers": [3, 4],
        "issues": [
          { "rowNumber": 4, "field": "packageDescription", "message": "Too small: expected string to have >=1 characters" }
        ]
      }
    ]
  }
}
```

`GET /api/v1/delivery-orders/import/template` returns a blank XLSX workbook named `delivery-orders-template.xlsx` with the shared headers on its `Orders` worksheet. Both endpoints use the normal authenticated API client; drivers receive `403`.

### `GET /api/v1/delivery-orders/{orderId}`

Reads one order inside the caller's organization.

| Status | When |
|---|---|
| `200` | Order found and owned by the caller's organization |
| `400` | `orderId` is not a UUID |
| `401` | Missing/invalid access token |
| `404` | Unknown id **or** an order owned by another organization (DO-010) |
| `500` | Unexpected failure |

Response `200 OK` uses the same `data` object as the create response.

### `PATCH /api/v1/delivery-orders/{orderId}`

An authenticated ADMIN or DISPATCHER may change one or more whole order-owned
`recipient`, `deliveryAddress`, or `packages` values only while status is
`created`. Omitted values remain unchanged; at least one value is required.
Each supplied value uses the same shape and validation as creation (packages
replace the whole ordered array). `id`, `organizationId`, `publicCode`, status,
and `createdAt` cannot be changed. Returns `200` with the updated order DTO;
`updatedAt` reflects the edit. Unknown/foreign ids return `404`; a non-created
order returns `409`. Invalid/unknown body fields return `400`, an absent token
`401`, and a DRIVER `403`. Rejected edits change neither the order nor its
status history. Editing details does not create a status-transition event.

### `POST /api/v1/delivery-orders/{orderId}/cancel`

Only an authenticated ADMIN or DISPATCHER may cancel an order in `created`,
`planned` or `assigned`. No request body is accepted. The response is `200`
with the order DTO, `status: cancelled`, and an updated `updatedAt`; the order,
recipient, address, packages and `createdAt` remain stored. Each successful
change records `fromStatus`, `toStatus`, `actorUserId` and `occurredAt` in the
same transaction. An unknown or foreign order returns the same `404`, an invalid
id `400`, a missing token `401`, a DRIVER `403`, and a repeated/invalid transition
`409`. No status or history changes on rejection.

### `GET /api/v1/delivery-orders/{orderId}/history`

Any authenticated role in the order's organization may read chronological
status transitions as `{ "data": [{ "fromStatus": "created", "toStatus":
"cancelled", "actorUserId": "<uuid>", "occurredAt": "<ISO-8601>" }] }`.
A new order returns `data: []`; foreign or unknown ids return `404`.

### `GET /api/v1/delivery-orders`

Lists only orders owned by the authenticated organization, sorted by `createdAt`
then `id` (ascending). Returns `200` with `{ "data": [<order DTO>, ...] }`, or
`{ "data": [] }` when empty. Cancelled orders remain visible. A missing/invalid
token returns `401`; unknown query parameters return `400`. Other filters and
pagination remain future work.

### `GET /api/v1/delivery-orders?publicCode=...`

Reads one order by its readable code. The code is normalized to uppercase and
looked up inside the caller's organization; the internal id is never accepted
here.

Example: `GET /api/v1/delivery-orders?publicCode=ord-2026-0001`

| Status | When |
|---|---|
| `200` | Code found in the caller's organization |
| `400` | `publicCode` missing, malformed, or an unknown query parameter is present |
| `401` | Missing/invalid access token |
| `404` | Unknown code **or** a code owned by another organization |
| `500` | Unexpected failure |

### List filters and pagination (future)

The tenant list and `publicCode` lookup are implemented. `status`, date ranges,
cursor pagination and `limit` remain future work.

## Error model

Every non-2xx API response (health readiness is the documented exception) uses
one envelope:

```json
{
  "error": {
    "code": "DELIVERY_ORDER_INVALID_INPUT",
    "message": "Create delivery order request body is invalid",
    "details": {
      "issues": [
        {
          "path": "recipient.phone",
          "message": "phone may contain digits, spaces, parentheses, hyphens and an optional leading +"
        }
      ]
    },
    "correlationId": "c0ffee00-0000-4000-8000-000000000000"
  }
}
```

`details` is omitted when there is nothing safe to add. The envelope never echoes
the request body.

| Failure | `code` | HTTP |
|---|---|---|
| Zod/value-object rejection | `DELIVERY_ORDER_INVALID_INPUT` | `400` |
| Malformed JSON body | `INVALID_JSON` | `400` |
| Missing access token | `AUTH_TOKEN_MISSING` | `401` |
| Invalid/expired access token | `AUTH_TOKEN_INVALID` | `401` |
| Unknown order id | `DELIVERY_ORDER_NOT_FOUND` | `404` |
| Order owned by another organization | `DELIVERY_ORDER_NOT_FOUND` | `404` |
| Unknown route | `ROUTE_NOT_FOUND` | `404` |
| Duplicate public code or aggregate invariant | `DELIVERY_ORDER_INVARIANT_VIOLATION` | `409` |
| Request body over 100 kB | `PAYLOAD_TOO_LARGE` | `413` |
| Unhandled failure | `INTERNAL_ERROR` | `500` |

### Enumeration safety (DO-010)

`DeliveryOrderForbiddenError` is a distinct application error (DO-003) but maps to
`404` with the not-found code and message shape. The real reason and the
organization ids are logged at warn level with the correlation id. This prevents a
caller from confirming that an order exists in another tenant.

## Health endpoints

| Endpoint | Purpose | Success | Failure |
|---|---|---|---|
| `GET /healthz` | Liveness; used by the container healthcheck | `200 {"status":"ok"}` | Never while the process can serve HTTP |
| `GET /readyz` | Readiness; runs an injected `SELECT 1` probe | `200 {"status":"ready","checks":{"database":"up"}}` | `503 {"status":"not_ready","checks":{"database":"down"}}` |

Readiness responses are status documents, not error envelopes: they describe a
dependency state that changes on its own and must never leak connection strings
or credentials. The probe retries lazily, so the API can boot before PostgreSQL is
reachable and become ready afterwards.

## Security and privacy

- Recipient name and phone are personal data. Request bodies are never logged;
  header credentials are redacted; the error envelope never copies request data.
- Public codes are not credentials. Public tracking uses a separate opaque,
  revocable token (ADR-003), not `publicCode` and not the internal UUID.
- Tenancy is enforced by verified JWT claims: a caller can only address its own
  organization, and cross-organization reads are indistinguishable from `404`.
- Every state-changing operation will write an audit event in the same
  transaction once the audit model exists; creation is currently audited only by
  the domain event.
