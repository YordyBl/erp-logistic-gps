# Fleet pagination and trip stats

Objective: server-side pagination/filters for vehicles and drivers, per-driver trip stats, and a metrics period filter on both screens.
Branch: feat/redesign-back · Delivery: ask-on-risk, one commit per slice (A-D) · Runner: `npx vitest run` (root), `npm run typecheck`, `npm run lint`.

## Specs

- S1 (L1): "como en vehiculos necesito ver tambien la cantidad de viajes que hizo cada conductor". A trip = route in `planned | in_progress | completed`; completed shown separately (same rule as vehicles).
- S2 (L2): "el listado de conductores tambien debe tener paginado y filtros de busqueda por backend no por frontend". `GET /drivers` returns `{ data, meta }` with `page`, `pageSize`, `q` (fullName, documentNumber, licenseNumber, phone), `sort`, `status`, `account` (`linked|unlinked`) and `meta.counts` facets.
- S3 (L3): "añade tambien ahí paginado y filtro del listado de vehiculos". `GET /vehicles` returns `{ data, meta }` with `page`, `pageSize`, `q` (plate, type), `sort`, `status` and `meta.counts.status`.
- S4 (L4): "añade tambien un filtro para las metricas, no para el listado, en ambos casos para poder ver las métricas a disposición". `route-stats` accepts `from`/`to` (`YYYY-MM-DD`, planned date); totals use the range, `lastRouteDay` stays all-time; absent = all history. UI period selector (Este mes, Últimos 3 meses, Últimos 6 meses, Este año, Todo) independent of list filters; changing it refetches only stats.
- S5 (decision): full lists move to `GET /vehicles/options` and `GET /drivers/options` (same roles, unchanged shape) so selector/lookup pages keep working; web `listVehicles()`/`listDrivers()` point there.
- S6 (decision): `route-stats` accepts optional `ids` so pages aggregate only visible rows; absent = every subject.

## Tasks

- [x] T1 S3,S5 — vehicles pagination + filters + `/vehicles/options` · inline · RED 8 api + 9 web tests → GREEN · d2492f9
- [x] T2 S2,S5 — drivers pagination + filters + `/drivers/options` · inline · RED 7 api + 9 web tests → GREEN · c52da38
- [x] T3 S4,S6 — generic route stats query with `ids` + from/to + vehicles period selector · inline · RED query/route/web tests → GREEN · 58433bc
- [x] T4 S1,S4 — `GET /drivers/route-stats` + driver trips UI with period selector · inline · RED 8 api + 2 web tests → GREEN

## Log

- L1 (2026-11-16): "vamos añadir una funcionalidad, como en vehiculos necesito ver tambien la cantidad de viajes que hizo cada conductor que me recomiendas ¿?"
- L2 (2026-11-16): "el listado de conductores tambien debe tener paginado y filtros de busqueda por backend no por frontend"
- L3 (2026-11-16): "añade tambien ahí paginado y filtro del listado de vehiculos"
- L4 (2026-11-16): "ahí tambien añade un filtro para las metricas, no para el listado, en ambos casos para poder ver las métricas a disposición"
- L5: Plan approved. Routes inline (no writer trigger: slices are sequential and share files). Forecast ~1500 authored lines → chained slices A-D.
- L6: T1 done. S6 (`ids`) moved to T3 so the stats query is refactored once. Header drops "kg de capacidad activa": it needs the whole fleet; summary now comes from `meta.counts.status` and is kept while searching. PostgreSQL parity test added but skipped (no `DATABASE_URL`; localtest DB not used). Checks: `npx vitest run` 688 passed / 78 skipped, `npm run typecheck` clean, eslint clean.
- L7: T2 done. Status and account facets both ignore the status and account filters (they are one chip group), so every chip keeps its count. Accent-insensitive search via `translate()` in SQL and NFD folding in memory (no `unaccent` extension). Account bindings now load separately: a failure shows a notice instead of blocking the page. Root README wrongly said any role could read drivers; fixed to ADMIN or DISPATCHER. Checks: vitest 696 passed / 79 skipped, typecheck clean, eslint clean; PostgreSQL parity test skipped (no `DATABASE_URL`).
- L8: T3 done. `RouteStatsTypeOrmQuery` groups by vehicle or driver (fixed table/column, never input); `VehicleRouteStatsTypeOrmQuery` and `DriverRouteStatsTypeOrmQuery` are thin adapters. Periods are whole calendar months in Lima ending with the current month (incl. routes planned later this month); "Este año" is Jan 1–Dec 31. Default period is "Todo" so the screens show what they showed before. Dropped the planned 12-month span cap: totals over any range are cheap aggregates. Checks: vitest 707 passed / 79 skipped, typecheck clean, eslint clean.
- L9: T4 done. Each driver card shows Viajes, Completados and Último viaje (all-time) for the visible page and the chosen period; failures show dashes. No monthly chart for drivers: the drivers screen has no detail panel (planned item 6 not done). Checks: vitest 717 passed / 79 skipped, typecheck clean, eslint clean. Pending: PostgreSQL integration/parity tests (skipped without `DATABASE_URL`).
