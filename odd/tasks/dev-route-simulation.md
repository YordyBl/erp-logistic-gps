# Development-only route simulation with automatic multi-stop completion
Objective: let dispatchers plan simulated routes in development that start automatically, move along Valhalla geometry, and close every stop and the route by themselves.
Branch: `feat/redesign` · Delivery: `ask-on-risk` · Runner: `npm test` (Vitest; PostgreSQL integration suites need `DATABASE_URL`)

## Specs

### S1 — Simulation exists only in an explicit development environment
- User requirement (verbatim): “todo esto se debe validar con la variable de entorno development, si esta en otro caso por ejemplo production o test no debería servir ni la simulación ni el cerrado automatico”
- Acceptance: simulation is enabled only when `NODE_ENV` is explicitly set to `development` (an unset `NODE_ENV`, which `loadConfig` defaults to development, does not enable it). Otherwise planning rejects `simulatedCompletionEnabled: true` with 400, the GPS simulator samples no positions and completes nothing, while GPS retention pruning keeps running. Tests inject the flag instead of reading the environment.
- Assumption: simulation also requires `VALHALLA_URL`, because without geometry no position is produced and the route would never close.

### S2 — Only drivers without a linked account can be simulated
- User requirement (verbatim): “solo se podrá simular con conductores que no esten vinculados a una cuenta , eso sería lo más correcto”
- Acceptance: planning a simulated route for a driver with a `driver_accounts` row fails with 409. Binding an account to a driver with a `planned` or `in_progress` simulated route fails with 409. Both checks run under the driver row lock.

### S3 — Simulated routes start when planned
- User decision (verbatim): “1. correcto, al planificarla”
- Acceptance: a simulated route is persisted `in_progress` with `startedAt`, its orders `in_transit`, one `in_progress` attempt per order, and order/route status history, in the same transaction as planning. Non-simulated planning is unchanged. Assumption: a simulated route requires an origin, so single-stop routes can move.

### S4 — The planning dispatcher is the recorded actor
- User decision (verbatim): “2. correcto”
- Acceptance: an additive migration adds a nullable `simulation_actor_user_id` to `delivery_routes`; simulated planning stores the planning user and every simulated history row uses it. Existing rows are not modified.

### S5 — Every simulated stop and route closes by itself
- User requirement (verbatim): “para la simulación todas las rutas deben cerrar solas claro cumpliendo con su propia lógica de negocio”
- User decision (verbatim): “es correcto” — simulated stops are always marked delivered.
- Acceptance: stops are detected from progress along the geometry using Valhalla leg distances, so a tick that skips several stops closes all of them in sequence. Each reached stop's `in_transit` orders become `delivered` with a terminal attempt carrying the simulated note and history; already-terminal orders are skipped. The route completes when every active order is terminal. Processing is idempotent, locks orders in `orderId` order, and is rejected outside development.

### S6 — Dispatchers can create simulations from the web
- Acceptance: a read endpoint reports whether simulation is available and which active drivers have no linked account. When available, the planning form shows a “Simular ruta” checkbox, an origin field, and restricts drivers to eligible ones; simulated routes show a visible “Simulada” label. When unavailable, the controls are hidden.

### S7 — Localtest can run simulations; docs reflect the behavior
- Acceptance: the localtest API reaches Valhalla, runs with a demo time scale, and has the new migration applied; `docs/operations/gps-tracking.md` and `docs/api/openapi.yaml` describe the development-only behavior and new endpoint.

## Tasks
- T1 — S1-S4 — inline — complete — environment gate, planning validation, auto-start, actor migration, binding guard; commit below
- T2 — S5 — inline — pending — leg-based stop detection and idempotent per-stop completion
- T3 — S6 — inline — pending — availability endpoint and web planning controls
- T4 — S7 — inline — pending — docs, OpenAPI, localtest Valhalla wiring, migration, demo check

Route evidence: tasks depend on each other (T2 uses T1's actor and gate, T3 uses T1's endpoint contract), so no parallel-writer reason exists; all inline. Risk items expected: 1 (migration), 3 (planning contract outside development), 4 (locks); independent verifier at the feature's end.

## Log
- L1 (2026-11-14): “para la simulación todas las rutas deben cerrar solas claro cumpliendo con su propia lógica de negocio, procede con el comando de planificación, lo detuve por error”
- L2 (2026-11-14): “pero ten en cuenta que el cerrado automatico solo es para la simulación, todo esto se debe validar con la variable de entorno development, si esta en otro caso por ejemplo production o test no debería servir ni la simulación ni el cerrado automatico, por otro lado  mientras estemos en dev el conductor no podrá modificar el estado del pedido, con eso sería suficiente ¿?”
- L3 (2026-11-14): “perdon, solo se podrá simular con conductores que no esten vinculados a una cuenta , eso sería lo más correcto,, cierto?” — replaces the dev-wide driver lock from L2.
- L4 (2026-11-14): “1. correcto, al planificarla 2. correcto 3. correcto” — auto-start at planning, dispatcher as actor, binding guard.
- L5 (2026-11-14): “es correcto, procede con todo y tambien guardando en engram por favor” — stops always delivered; implementation authorized.
- L6 (2026-11-14): Mapped seams. `findActiveRoutes` INNER JOINs `driver_accounts` (must become LEFT JOIN); Valhalla is called with `format: 'osrm'`, whose route legs carry per-leg distance; the web sends no origin; `/drivers/accounts` is ADMIN-only. RDD is on (global).
- L7 (2026-11-14): T1 implemented test-first. RED observed for config gate, plan-route simulation validation, simulated planning integration (auto-start, actor, linked-driver rejection), binding guard, and disabled simulator sampling; the HTTP 400 test pinned already-implemented behavior. `simulation_actor_user_id` is a plain nullable uuid (history actor FKs remain on their own tables). Start logic was extracted to `route-start.ts` and reused by driver start and simulated planning. Legacy tests that started simulated routes as a bound driver were adjusted. With an isolated `erp_logistic_sim_test` database: 428 tests passed, 1 skipped; 15 web test files fail to load because web dependencies (`lucide-react`, `react-hook-form`) are not installed locally — environmental, pre-existing. Lint of changed files clean; repository-wide lint fails on untracked generated media folders (pre-existing). API typecheck passed.
