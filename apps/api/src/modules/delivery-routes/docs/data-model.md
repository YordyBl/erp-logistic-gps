# Route planning data model

| Table | Purpose | Key constraints |
|---|---|---|
| `delivery_routes` | One manually planned run for one organization, driver and vehicle | Tenant-scoped public code; partial unique active driver and vehicle indexes (`planned`, `in_progress`); tenant-bound FKs |
| `delivery_stops` | Ordered physical stop, optional coordinate pair | Unique `(route_id, sequence)`; tenant-bound route FK |
| `delivery_stop_orders` | Order assigned to a stop; insertion position retained | Partial unique active order index, unique `(stop_id, position)`, tenant-bound route/stop/order FKs |
| `delivery_orders` | Existing order with nullable `active_route_id` | Tenant-bound route FK; prior rows retain `NULL` until planned |
| `delivery_order_status_history` | Append-only transitions with actor and instant | Two rows per newly planned order, committed with assignment |

IDs are UUIDs; dates use PostgreSQL `date`, instants use `timestamptz`, and
coordinates use `numeric(9,6)`. API returns ISO-8601 instants. The nullable
`active_route_id` permits existing Phase 2 orders and does not change their
public DTO shape. An inactive historical link is reserved for later explicit
dispatch decisions; this slice creates active links only.
