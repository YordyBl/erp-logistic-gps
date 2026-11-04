# Application services and module boundaries

This page maps the API's application modules to their responsibilities and primary operations. It complements the HTTP contract in [`../api/openapi.yaml`](../api/openapi.yaml); it is a module-level guide, not a class-by-class inventory of every adapter or helper.

## Application modules

| Module | Responsibility | Primary application operations |
|---|---|---|
| `identity-and-access` | Organization registration, user accounts, authentication, and session lifecycle. | Register organization; create user; log in; refresh or revoke a session. |
| `customers` | Organization-scoped customer directory used by delivery orders. | Create, retrieve, and list customers. |
| `delivery-orders` | Order and package lifecycle, address and coordinates, cancellation, and status history. | Create, retrieve, list, edit, and cancel orders. |
| `delivery-routes` | Route planning and dispatch assignment, plus the driver's route execution state transitions. | Plan, retrieve, list, and reassign routes; execute driver route actions. |
| `delivery-execution` | Delivery evidence lifecycle and its storage boundary. | Upload, list, and download delivery evidence. |
| `delivery-tracking` | Authenticated live snapshots and organization-scoped route, order, and position updates. | Issue a short-lived tracking ticket; connect to the tracking WebSocket; publish updates. |
| `drivers` | Driver profiles and links between driver profiles and user accounts. | Create, retrieve, list, update, and bind driver accounts. |
| `vehicles` | Organization-scoped vehicle fleet catalog. | Create, retrieve, list, and update vehicles. |

The API adapters expose these capabilities under `/api/v1`. Authentication and role checks are applied at the HTTP boundary; organization-scoped use cases receive the organization identity derived from the authenticated session rather than trusting a caller-supplied tenant ID.

## Supporting application services

| Service | Responsibility |
|---|---|
| Dispatch dashboard query | Aggregates organization-scoped order, route, delivery, incident, and recent-activity data for the dispatch dashboard. |
| Google Maps link resolver | Resolves supported Google Maps URLs to coordinates using bounded HTTPS requests and validated redirects. It does not scrape page HTML. |
| WebSocket ticket store and tracking hub | Issues one-use, short-lived tracking credentials; validates them during WebSocket upgrade; sends snapshots and updates to authorized clients. |
| Evidence object storage adapter | Persists delivery evidence bytes and returns authorized evidence for download. |
| PostgreSQL/TypeORM repositories | Persist module aggregates and queries behind application ports. |

## Where to look next

- [`../api/openapi.yaml`](../api/openapi.yaml) — HTTP endpoints, request/response schemas, and error responses, including the dispatch dashboard and live-tracking handshake.
- [`data-model.md`](data-model.md) — persistent entities, relationships, and invariants.
- [`decisions/ADR-001-modular-monolith-hexagonal-slices.md`](decisions/ADR-001-modular-monolith-hexagonal-slices.md) — module and dependency boundaries.
- [`../operations/gps-tracking.md`](../operations/gps-tracking.md) — operating the GPS tracking flow.
