# Delivery routes and dispatch

This module plans manual routes for one organization. Route creation assigns one
active driver and vehicle, groups orders into sequenced stops, and moves those
orders from `created` through `planned` to `assigned` with audit history. The
`POST` response is readable from its `Location` URL.

## Current scope

- ADMIN and DISPATCHER can plan routes; authenticated roles can read a route
  within their organization. ADMIN and DISPATCHER can reassign the driver and
  vehicle of a planned route.
- A stop can contain multiple orders, but an order cannot belong to two active
  routes. Driver and vehicle active assignments are exclusive, including after
  reassignment.
- Redespacho, route progress, delivery execution and tracking are
  not part of the planning slice. The route lifecycle depends on the later
  dispatch work units; no `returned`-order redespacho policy is assumed.

See [business rules](business-rules.md), [data model](data-model.md),
[architecture](architecture.md), [API contracts](api-contracts.md), and
[decisions](decisions.md). The public HTTP contract is in
[`docs/api/openapi.yaml`](../../../../../../docs/api/openapi.yaml).
