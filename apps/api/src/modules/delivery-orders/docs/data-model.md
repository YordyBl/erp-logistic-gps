# Data model — `delivery-orders`

The aggregate is small on purpose: one root, three value objects, one status enum and one
domain event. Persistence is implemented with TypeORM in Data Mapper mode: the domain stays
framework-free and the PostgreSQL mapping lives entirely under `infrastructure/persistence`.

## Quick path

1. `docker compose up -d postgres`
2. `DATABASE_URL=postgres://erp_logistic:change-me-local-only@localhost:5432/erp_logistic npm run migration:run -w apps/api`
3. `DATABASE_URL=postgres://erp_logistic:change-me-local-only@localhost:5432/erp_logistic npm test`

Without `DATABASE_URL` (or when PostgreSQL is unreachable) the integration tests skip with a
logged reason; the unit suite still runs.

## Aggregate

```mermaid
classDiagram
    class DeliveryOrder {
        +UUID id
        +UUID organizationId
        +string publicCode
        +Recipient recipient
        +DeliveryAddress deliveryAddress
        +Package[] packages
        +DeliveryOrderStatus status
        +string createdAt
        +string updatedAt
        +create(props) DeliveryOrder
    }

    class Recipient {
        +string name
        +string phone
    }

    class DeliveryAddress {
        +string addressLine
        +string district
        +number latitude
        +number longitude
    }

    class Package {
        +string code
        +string description
        +number weightKg
    }

    DeliveryOrder "1" *-- "1" Recipient
    DeliveryOrder "1" *-- "1" DeliveryAddress
    DeliveryOrder "1" *-- "1..100" Package
```

`DeliveryOrder` is the only aggregate root. Packages are value objects in this pilot: they
are created with the order, cannot move between orders and are replaced only by a future
explicit use case. Their database rows receive UUIDs and a `position` column so a round trip
returns the same sequence, but that identity is not part of the domain contract.

## Domain entities and value objects

### `DeliveryOrder`

| Field | Type | Nullable | Rule |
|---|---|---|---|
| `id` | UUID string | No | Internal identifier; never a URL/public credential |
| `organizationId` | UUID string | No | Tenant root; every read checks it |
| `publicCode` | string | No | 3–32 uppercase letters/digits/hyphens; unique per organization; display/lookup aid only |
| `recipient` | `Recipient` | No | Value object |
| `deliveryAddress` | `DeliveryAddress` | No | Value object |
| `packages` | `readonly Package[]` | No | One or more; unique codes; frozen array |
| `status` | `DeliveryOrderStatus` | No | Starts at `created`; read-only in the pilot |
| `createdAt` | ISO-8601 string | No | Supplied by `Clock` |
| `updatedAt` | ISO-8601 string | No | Equal to `createdAt` until a transition exists |

### `Recipient`

| Field | Type | Nullable | Rule |
|---|---|---|---|
| `name` | string | No | Trimmed, 1–120 |
| `phone` | string | No | Trimmed, 6–20 characters; 6–15 digits; formatting characters allowed |

### `DeliveryAddress`

| Field | Type | Nullable | Rule |
|---|---|---|---|
| `addressLine` | string | No | Trimmed, 5–200 |
| `district` | string | No | Trimmed, 2–80; free text until a Lima catalogue exists |
| `latitude` | number | Yes | −90..90; required when longitude exists |
| `longitude` | number | Yes | −180..180; required when latitude exists |

### `Package`

| Field | Type | Nullable | Rule |
|---|---|---|---|
| `code` | string | No | 1–40; uppercase letters/digits/hyphen/underscore; unique inside the order |
| `description` | string | No | Trimmed, 1–200 |
| `weightKg` | number | Yes | Finite, > 0, ≤ 1000 |

### Status enum

```ts
type DeliveryOrderStatus =
  | 'created'
  | 'planned'
  | 'assigned'
  | 'in_transit'
  | 'delivered'
  | 'returned'
  | 'cancelled';
```

`failed` is not part of the order status. See [business-rules.md](business-rules.md) for the
ratified incident rule and [decisions.md](decisions.md) for the rationale.

## Application DTO

`DeliveryOrderDto` is the serializable output of both use cases.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Internal UUID |
| `organizationId` | string | UUID |
| `publicCode` | string | Normalized uppercase |
| `status` | `DeliveryOrderStatus` | Canonical enum |
| `recipient` | `{ name, phone }` | Personal data; redact in logs |
| `deliveryAddress` | `{ addressLine, district, latitude, longitude }` | Coordinates are `number \| null` |
| `packages` | `{ code, description, weightKg }[]` | `weightKg` is `number \| null` |
| `createdAt` | string | ISO-8601 instant |
| `updatedAt` | string | ISO-8601 instant |

Optional domain values become explicit `null` in the DTO so clients do not have to
distinguish “absent key” from “unknown value”.

## Persistence schema

Implemented by migration `apps/api/migrations/1793073274116-InitialDeliveryOrders.ts` and mapped
by the TypeORM entities under `infrastructure/persistence/entities`. `synchronize` is `false`
in every environment (ADR-002 §3): the migration, not the entity metadata, creates the schema.

The package rows cascade with their parent order, so deleting an order also deletes its
packages. The order row and its package rows are written in one transaction by the repository
adapter, so there is never a partially written aggregate.

### `delivery_orders`

| Column | PostgreSQL type | Null | Constraint |
|---|---|---|---|
| `id` | `uuid` | No | Primary key |
| `organization_id` | `uuid` | No | Indexed; tenant filter. FK `organization(id)` deferred until the organizations table exists |
| `public_code` | `varchar(32)` | No | Unique `(organization_id, public_code)`; check matches the module format |
| `recipient_name` | `varchar(120)` | No | |
| `recipient_phone` | `varchar(20)` | No | |
| `delivery_address_line` | `varchar(200)` | No | |
| `delivery_district` | `varchar(80)` | No | Free text until a Lima catalogue exists |
| `latitude` | `numeric(9,6)` | Yes | Check −90..90; paired with `longitude` |
| `longitude` | `numeric(9,6)` | Yes | Check −180..180; paired with `latitude` |
| `status` | `varchar(20)` | No | Default `created`; check against the canonical status list |
| `created_at` | `timestamptz` | No | Absolute instant |
| `updated_at` | `timestamptz` | No | Absolute instant; equals `created_at` until a transition use case exists |

Checks: `latitude` and `longitude` are both null or both present; each coordinate is inside
its valid range; `public_code` matches `^[A-Z0-9]+(-[A-Z0-9]+)*$`; `status` is one of the
canonical values. Future columns (`customer_account_id`, `active_route_id`, `time_window`,
`notes`) arrive with their own modules and migrations.

### `delivery_order_packages`

| Column | PostgreSQL type | Null | Constraint |
|---|---|---|---|
| `id` | `uuid` | No | Primary key (generated on save, not exposed by the aggregate) |
| `delivery_order_id` | `uuid` | No | FK `delivery_orders(id)` `ON DELETE CASCADE` |
| `position` | `integer` | No | Check `>= 0`; preserves aggregate order |
| `code` | `varchar(40)` | No | Unique `(delivery_order_id, code)` |
| `description` | `varchar(200)` | No | |
| `weight_kg` | `numeric(10,3)` | Yes | Check `> 0` and `<= 1000` |

The foreign key is also the child lookup path: the unique constraint on
`(delivery_order_id, code)` starts with the FK column, so PostgreSQL can use it for
"packages of this order" reads.

### Indexes and constraints

| Name | Kind | Columns | Reason |
|---|---|---|---|
| `uq_delivery_orders_organization_public_code` | unique constraint | `(organization_id, public_code)` | Per-tenant readable-code lookup and duplicate protection |
| `idx_delivery_orders_organization_id` | index | `(organization_id)` | Tenant-scoped reads and future operating lists |
| `uq_delivery_order_packages_order_code` | unique constraint | `(delivery_order_id, code)` | Package code uniqueness inside the order |
| `chk_delivery_orders_*` | check constraints | see table | Status, public-code format, coordinate ranges and coordinate pairing |
| `chk_delivery_order_packages_*` | check constraints | see table | Positive weight and non-negative position |

## Timezone convention

`created_at` and `updated_at` are `timestamptz`: PostgreSQL stores absolute instants and
renders them in the session timezone. The data source pins every connection to
`America/Lima` (`extra.options = '-c timezone=America/Lima'`) and the compose PostgreSQL
service sets `timezone=America/Lima` at the server level. Concretely,
`2026-10-26T15:00:00.000Z` is stored as that instant and renders as `10:00:00-05:00`; the
stored value never shifts. API/UI rendering in Lima time is an HTTP-layer responsibility.

## Mapping notes

- Value objects map to flattened columns; there are no JSON blobs for recipient or address.
- `weightKg`, `latitude` and `longitude` are JavaScript numbers in the domain and `numeric`
  in PostgreSQL. `pg` returns numeric values as strings, so the mapper converts them
  explicitly; measurements are never stored as floating point.
- Aggregates are saved whole: the adapter upserts the order row, replaces its package rows
  and commits both in one transaction. Package rows are regenerated on each save and sorted
  by `position` on load.
- The mapper reconstructs the aggregate with `DeliveryOrder.create`, which the current pilot
  domain only supports for the initial `created` status. A persisted row with another status
  makes the mapper fail loudly until the status-transition use case is added.
- `findByPublicCode` always filters by `organization_id`. `findById` intentionally does not,
  because the read use case must distinguish a missing order from an order owned by another
  organization and raise the typed forbidden error itself. This matches the repository port
  contract and keeps the tenant check in the application layer.
- A concurrent duplicate public code is caught by the unique constraint; the adapter maps
  PostgreSQL error `23505` on that constraint to `DeliveryOrderInvariantError`, the same
  typed error the use case raises before saving.
- No table stores status history yet. Audit events are a cross-cutting requirement
  (invariant 8) and will be written in the same transaction once the audit model exists.

## Known deviations

- Table names are plural (`delivery_orders`, `delivery_order_packages`); ADR-002 §7 says
  singular table names. The implemented names follow the persistence task; aligning the ADR
  or renaming the tables is a follow-up for the parent milestone.
- `organization_id` has no foreign key yet because no `organizations` table exists in this
  milestone. The column is mandatory and indexed so the constraint can be added later
  without a data migration.
