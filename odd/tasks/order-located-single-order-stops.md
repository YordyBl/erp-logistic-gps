# Orders always carry coordinates; one stop per order inherits its location
Objective: every delivery order has coordinates, and route stops are derived one-to-one from orders so a stop's address and coordinates always come from its order. This also closes the verifier finding that a simulated route with an unlocated stop never moves or closes.
Branch: `feat/redesign-back` · Delivery: `ask-on-risk` · Runner: `npm test` (Vitest; PostgreSQL integration suites need `DATABASE_URL`)

## Specs

### S1 — An order cannot exist without coordinates
- User requirement (verbatim): “porque no mejor bloqueamos los pedidos que no tengan coordenadas ? es decir, que no se pueda crear un pedido sin coordenadas?”
- Acceptance: creating an order without `deliveryAddress.latitude`/`longitude` returns 400; editing cannot remove them. The Google Maps link stays optional as a reference (the web resolves it to coordinates before submit). Bulk import (CSV/XLSX) requires the `latitude` and `longitude` columns per row. The web order form requires coordinates (typed or resolved from the link).
- Assumption: no existing rows lack coordinates (user: “no existen registros existentes sin coordenadas porque estamos en dev”), so no data migration; the database column stays nullable.

### S2 — One stop per order, location inherited from the order
- User requirement (verbatim): “la parada siempre debe heredar la de los pedidos … para varias paradas cada parada debe estar vinculado a su pedido”
- User decision: “1 parada = 1 pedido” (grouping several orders in one stop is removed).
- Acceptance: for every route (simulated or not) each planned stop references exactly one order; the stop's address and coordinates are copied from that order at planning time (a snapshot: later order edits do not change a planned route). The plan request no longer accepts stop `addressLine`, `googleMapsUrl` or coordinates. The planning form lets the dispatcher pick and sequence orders; no manual stop address or link fields. The simulated route origin stays manual.
- Assumption: route responses keep `stops[].orderIds` (always one element) so read-side consumers do not change.

### S3 — Account binding guard only targets dispatcher simulations
- Verifier finding 2 (accepted): the binding guard also matches legacy `simulated_completion_enabled` routes without `simulation_actor_user_id`, which never auto-close.
- Acceptance: the guard requires `simulation_actor_user_id IS NOT NULL`.

## Tasks
- T1 — S1 — inline — complete — create/edit/import require coordinates; web form requires them; OpenAPI `DeliveryAddressInput`
- T2 — S2 — inline — complete — plan request `stops: [{ sequence, orderId }]`; store copies the locked order location; planning UI with ordered single-order stops; OpenAPI, gps-tracking.md, README
- T3 — S3 — inline — complete — binding guard requires `simulation_actor_user_id IS NOT NULL`; integration test covers legacy and dispatcher-owned routes

## Log
- L1 (2026-11-14): Verifier on `dev-route-simulation` found a simulated route can be planned with a stop without coordinates and then never moves or closes (no cancel endpoint, driver unbound, binding blocked). User chose to make coordinates mandatory on orders and derive stops from orders instead of a simulation-only stop check. Verifier finding 3 (environment switch with running simulations) dropped by the user: development is local only; test and production run on the VPS.
- L2 (2026-11-14): T1 test-first. RED: create without coordinates, CSV import group without coordinates, PATCH address without coordinates, web form submit without coordinates. Implemented by requiring `latitude`/`longitude` in the shared `deliveryAddressSchema` (create, import reuse it; edit now reuses it too) and by making them required import headers; the domain `DeliveryAddress.create` stays tolerant because the persistence mapper rehydrates through it. Web form marks “Ubicación *”, “Latitud *”, “Longitud *” as required. Full suite: 538 passed, 1 skipped; API and web typecheck clean.
- L3 (2026-11-14): T2 test-first. RED: use-case stop contract (one `orderId`, no location fields, no grouping), store snapshot of the locked order location and 409 for an order without coordinates, web planning form (ordered single-order stops, reorder/remove, at least one order). `RoutePlanningStore.plan` now takes a `RoutePlanDraft` (stops `{ id, sequence, orderId }`) and returns the located `PlannedRoute`; both adapters copy address and coordinates, the TypeORM one after the `FOR UPDATE` order lock. Responses keep `stops[].orderIds` with one element, so read-side consumers are unchanged. The web form drops stop address/link fields. Existing tests that grouped orders in one stop were rewritten to one stop per order (the sequential simulated-closure case now has four stops). HTTP body validation for routes keeps its existing generic error code.
- L4 (2026-11-14): T3 test-first: a legacy opted-in route without actor no longer blocks binding; a dispatcher-owned one still does. Full suite: 546 passed, 1 skipped; API and web typecheck clean. Lint: one pre-existing error (`CardHeader` unused in `apps/web/src/auth/LoginScreen.tsx`), unrelated and left untouched.
