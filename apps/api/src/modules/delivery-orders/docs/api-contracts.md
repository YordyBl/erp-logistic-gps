# API contracts — `delivery-orders`

> **Status: proposed, not implemented.** The module has no HTTP adapter yet. This document
> fixes the intended request/response shape for the future Express layer; the OpenAPI 3.1
> document will become the source of truth for HTTP and may refine examples without
> changing the application contract.

## Conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1` |
| Authentication | `Authorization: Bearer <JWT access token>`; 15-minute access token, rotating refresh cookie (ADR-003) |
| Tenant scope | `organizationId` comes from validated JWT claims. It is never accepted from the body, path or query |
| Roles | `ADMIN` and `DISPATCHER` may create and read orders. `DRIVER` access is limited to assigned orders in a later milestone |
| Content type | `application/json; charset=utf-8` |
| Ids | Internal UUIDs in paths. Public codes are lookup/display values, never credentials |
| Timestamps | ISO-8601 instants on the wire; clients render America/Lima (`-05:00`) |
| Correlation | `X-Correlation-Id` echoed in responses and logs (format pending, architecture plan §11.12) |

## Endpoints

### `POST /api/v1/delivery-orders`

Creates one order in the caller's organization.

Permissions: `ADMIN`, `DISPATCHER`.

Request body:

```json
{
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

Notes:

- `organizationId` is injected by the adapter from the access token; a body field with that
  name is rejected as unknown input.
- `publicCode` is currently supplied by the caller and validated for per-organization
  uniqueness. Server-side sequence generation is a pending decision (see `decisions.md`).
- `deliveryAddress.latitude` and `longitude` are optional, but must appear together.
- Unknown properties are rejected (`strict` schemas).

Response `201 Created`:

```json
{
  "data": {
    "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "organizationId": "11111111-1111-4111-8111-111111111111",
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

Headers: `Location: /api/v1/delivery-orders/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`.

### `GET /api/v1/delivery-orders/{orderId}`

Reads one order inside the caller's organization.

Permissions: `ADMIN`, `DISPATCHER`. Drivers will read their assigned orders in a later
milestone.

Response `200 OK`: same `data` object as the create response.

Errors: `400` malformed UUID, `401` missing/invalid token, `403` role or tenant mismatch,
`404` order not found.

### `GET /api/v1/delivery-orders` (proposed, future)

Not part of the pilot. Planned filters and pagination:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `status` | `DeliveryOrderStatus` | none | Repeatable or comma-separated; exact match |
| `publicCode` | string | none | Exact match, normalized uppercase |
| `createdFrom` / `createdTo` | ISO-8601 | none | Inclusive range on `createdAt` |
| `cursor` | opaque string | none | Cursor-based pagination, stable order `(createdAt, id)` |
| `limit` | integer | `20` | 1–100 |

Response `data` is an array of order DTOs plus `meta.nextCursor`. Offset pagination is
rejected because operational lists change while a dispatcher pages through them.

## Error model

```json
{
  "error": {
    "code": "DELIVERY_ORDER_INVALID_INPUT",
    "message": "Create delivery order command is invalid",
    "details": {
      "issues": [
        { "path": "recipient.phone", "message": "phone may contain digits, spaces, parentheses, hyphens and an optional leading +" }
      ]
    },
    "correlationId": "c0ffee00-0000-4000-8000-000000000000"
  }
}
```

| Typed error | Code | HTTP | Notes |
|---|---|---|---|
| `DeliveryOrderValidationError` | `DELIVERY_ORDER_INVALID_INPUT` | `400` | Zod or value-object rejection; field paths included |
| `DeliveryOrderNotFoundError` | `DELIVERY_ORDER_NOT_FOUND` | `404` | Unknown order id |
| `DeliveryOrderForbiddenError` | `DELIVERY_ORDER_FORBIDDEN` | `403` | Order exists but belongs to another organization |
| `DeliveryOrderInvariantError` | `DELIVERY_ORDER_INVARIANT_VIOLATION` | `409` | Duplicate public code or aggregate invariant |
| Authentication failure | implementation-defined | `401` | Missing, expired or invalid token |
| Unhandled failure | `INTERNAL_ERROR` | `500` | No internal details or PII in the response |

Enumeration trade-off: the conceptual data model says cross-organization requests should
look like "not found" to avoid disclosing existence. The application currently exposes a
distinct forbidden error because the task requires it; the HTTP adapter may map it to `404`
for production once the security review decides. The decision and its risk are recorded in
`decisions.md` (DO-003).

## Security and privacy

- Recipient name and phone are personal data: never log the full payload; redact phone in
  structured logs and audit events (invariant 8 and plan §7).
- Public codes are not credentials. Public tracking uses a separate opaque, revocable token
  (ADR-003), not `publicCode` and not the internal UUID.
- The error envelope never echoes raw request bodies.
- Every state-changing operation will write an audit event in the same transaction once the
  audit model exists; creation is currently audited only by the domain event.
