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

- [x] T1 S3,S5 — vehicles pagination + filters + `/vehicles/options` · inline · RED 8 api + 9 web tests → GREEN
- [ ] T2 S2,S5 — drivers pagination + filters + options · inline
- [ ] T3 S4,S6 — generic route stats query with `ids` + from/to + vehicles period selector · inline
- [ ] T4 S1,S4 — `GET /drivers/route-stats` + driver trips UI with period selector · inline

## Log

- L1 (2026-11-16): "vamos añadir una funcionalidad, como en vehiculos necesito ver tambien la cantidad de viajes que hizo cada conductor que me recomiendas ¿?"
- L2 (2026-11-16): "el listado de conductores tambien debe tener paginado y filtros de busqueda por backend no por frontend"
- L3 (2026-11-16): "añade tambien ahí paginado y filtro del listado de vehiculos"
- L4 (2026-11-16): "ahí tambien añade un filtro para las metricas, no para el listado, en ambos casos para poder ver las métricas a disposición"
- L5: Plan approved. Routes inline (no writer trigger: slices are sequential and share files). Forecast ~1500 authored lines → chained slices A-D.
- L6: T1 done. S6 (`ids`) moved to T3 so the stats query is refactored once. Header drops "kg de capacidad activa": it needs the whole fleet; summary now comes from `meta.counts.status` and is kept while searching. PostgreSQL parity test added but skipped (no `DATABASE_URL`; localtest DB not used). Checks: `npx vitest run` 688 passed / 78 skipped, `npm run typecheck` clean, eslint clean.
