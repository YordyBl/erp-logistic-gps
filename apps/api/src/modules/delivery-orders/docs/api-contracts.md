# API contracts — `delivery-orders`

> **Status: implemented (Fase 0).** The Express adapter lives in
> `apps/api/src/http`. The OpenAPI 3.1 document at `docs/api/openapi.yaml` is the
> source of truth for HTTP; this page explains the conventions, decisions and
> error semantics that an OpenAPI reader cannot infer.

## Quick path

1. Send `x-organization-id: <uuid>` with every delivery-orders request.
2. `POST /api/v1/delivery-orders` → `201` with the created resource and a `Location` header.
3. Read it back with `GET /api/v1/delivery-orders/{orderId}` or
   `GET /api/v1/delivery-orders?publicCode=...`.
4. Read failures from the single error envelope; a cross-organization read is an
   indistinguishable `404`.

## Conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1` |
| Tenancy (temporary) | Fase 0 reads the caller's organization from `x-organization-id` (dev-only middleware). Fase 1 replaces it with verified JWT claims (ADR-003). Missing or malformed header → `401`. The organization is never accepted from the body, path or query. |
| Authentication | Not implemented in Fase 0. JWT access tokens (15 min) and RBAC land in Fase 1. |
| Content type | `application/json; charset=utf-8` |
| Ids | Internal UUIDs in paths. Public codes are lookup/display values, never credentials. |
| Timestamps | ISO-8601 instants on the wire (UTC `Z`, as produced by the clock and `timestamptz` persistence). Clients render America/Lima (`-05:00`). |
| Correlation | Every response carries `x-request-id`. A safe incoming value is honored; otherwise the API generates one. The same value appears as `correlationId` in error bodies. |
| Validation | Zod at the HTTP boundary reuses the application command/query schemas. Unknown body and query keys are rejected (`400`). |
| Logging | Request method, URL, headers, status and timing are logged as structured JSON. Bodies are never logged; `authorization` and `cookie` headers are redacted. Log timestamps use the Lima offset. |

## Endpoints

### `POST /api/v1/delivery-orders`

Creates one order in the caller's organization.

Required headers: `x-organization-id`. Optional: `x-request-id`, `content-type: application/json`.

Request body — `organizationId` is not part of the accepted shape and is rejected as an unknown key:

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
| `401` | Missing/invalid `x-organization-id` |
| `409` | `publicCode` already used in the organization |
| `500` | Unexpected failure; generic message, no internals |

### `GET /api/v1/delivery-orders/{orderId}`

Reads one order inside the caller's organization.

| Status | When |
|---|---|
| `200` | Order found and owned by the caller's organization |
| `400` | `orderId` is not a UUID |
| `401` | Missing/invalid `x-organization-id` |
| `404` | Unknown id **or** an order owned by another organization (DO-010) |
| `500` | Unexpected failure |

Response `200 OK` uses the same `data` object as the create response.

### `GET /api/v1/delivery-orders?publicCode=...`

Reads one order by its readable code. The code is normalized to uppercase and
looked up inside the caller's organization; the internal id is never accepted
here.

Example: `GET /api/v1/delivery-orders?publicCode=ord-2026-0001`

| Status | When |
|---|---|
| `200` | Code found in the caller's organization |
| `400` | `publicCode` missing, malformed, or an unknown query parameter is present |
| `401` | Missing/invalid `x-organization-id` |
| `404` | Unknown code **or** a code owned by another organization |
| `500` | Unexpected failure |

### List filters and pagination (future)

Only `publicCode` lookup is implemented. `status`, date ranges, cursor pagination
and `limit` remain future work; today a request without `publicCode` is `400`.

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
| Missing tenant header | `ORGANIZATION_REQUIRED` | `401` |
| Malformed tenant header | `ORGANIZATION_INVALID` | `401` |
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
- The temporary `x-organization-id` header is not authorization. Any caller can
  claim any organization until JWT verification lands in Fase 1.
- Every state-changing operation will write an audit event in the same
  transaction once the audit model exists; creation is currently audited only by
  the domain event.
