# Feature: Global order codes and Google Maps links
Objective: Generate global sequential order/package codes and resolve editable delivery coordinates from saved Google Maps links.
Branch: `feature/phase-4-delivery-execution` · Delivery: `ask-on-risk` · Runner: `npm test` (Vitest), API PostgreSQL integration tests

## Specs

### S1 — Globally sequential order and package codes
- Authorized scope: public order codes and package codes are generated automatically and sequentially, using a single sequence shared across organizations; users do not manually enter these codes in the create-order form.
- User requirement (verbatim): “el codigo publico debe ser automatico el codigo de los bultos tambien debe ser autogenerado y correlativo al igual que codigo publico”
- User clarification (verbatim): “una sola secuencia compartida porque al ver el historial pueden existir 2 viajes con un mismo codigo”
- Acceptance: concurrent creates across organizations cannot issue the same generated public or package code; generated codes are returned and displayed; current explicit-code import/API behavior remains compatible unless directly changed by this requirement.
- Assumption: public-order codes and package codes each use their own global monotonic sequence and distinguishable prefixes; sequence gaps after failed/abandoned creates are acceptable.
- Checks: focused use-case/HTTP/PostgreSQL concurrency tests; existing create/import behavior regression tests; full suite and build.

### S2 — Persist Google Maps link and editable coordinates
- Authorized scope: add a Google Maps link to order address data; resolve it to latitude/longitude, prefill those fields in the order form, allow manual edits, and retain the link with the order.
- User requirement (verbatim): “además en los pedidos debe estar tambien el link de google maps y apartir de lo que entrega el link llenar la longitud y latitud automaticamente, además de poder editarse a disposición”
- Acceptance: supported Google Maps links resolve through the existing validated resolver; the form fills both coordinates and leaves them editable; link, address, and coordinates survive create, read, and edit; resolution errors are visible and never silently replace coordinates.
- Assumption: the Maps link is optional to preserve existing address-only order creation; when supplied it is persisted, and users may manually correct either coordinate after lookup.
- Checks: resolver/HTTP tests with a stubbed fetcher; form tests for success, failure, manual edit and saved link; persistence migration/integration tests; full suite and build.

## Tasks
- T1 — S1 — inline — in progress — Risk: items 1 and 4; PostgreSQL sequence migration and in-memory allocation, create UI and OpenAPI updates implemented; full PostgreSQL suite passes — commit pending
- T2 — S2 — inline — in progress — Risk: items 1 and 3; Maps URL persistence, bounded resolver endpoint, editable coordinate autofill and OpenAPI updates implemented; full PostgreSQL suite passes — commit pending

## Log
- L1 (2026-11-03): “el codigo publico debe ser automatico el codigo de los bultos tambien debe ser autogenerado y correlativo al igual que codigo publico, además en los pedidos debe estar tambien el link de google maps y apartir de lo que entrega el link llenar la longitud y latitud automaticamente, además de poder editarse a disposición”
- L2 (2026-11-03): “una sola secuencia compartida porque al ver el historial pueden existir 2 viajes con un mismo codigo”
- L3 (2026-11-03): CodeGraph and read-only mapping found that create-order and import share the API use case, order/package writes are transactional, current public-code checks are tenant-scoped, package code uniqueness is per-order, and an existing validated Google Maps short-link resolver can be reused. Existing repository has 134 changed paths; isolate this task's edits and preserve prior work. Native review is on but previous accumulated candidate was blocked at intended-untracked selection.
- L4 (2026-11-03): “ok, procede con lo de google me parece que antes debemos hacer un fetch al link de google para obtener las cordenadas algo como web scraping”. The existing `GoogleMapsLinkResolver` performs bounded HTTPS GETs, follows only manually revalidated allowlisted Google redirects, and extracts coordinates from the final URL; it does not scrape/download page HTML. Reused that safer mechanism rather than broad HTML scraping. Added persisted `googleMapsUrl`, authenticated resolution endpoint, editable UI coordinate fill, and saved-link submission. No real user URL was fetched. Focused tests and full suite/typecheck passed (389 passed; 57 skipped because `DATABASE_URL` is unset); PostgreSQL migration/integration proof remains pending.
- L5 (2026-11-03): Added an HTTP test of the authenticated coordinate-resolution endpoint using a direct coordinate-bearing Google Maps URL (no outbound fetch), updated OpenAPI for generated codes, saved Maps URL, and resolver endpoint. Final observed checks: `npm test` — 390 passed, 57 skipped due to unset `DATABASE_URL`; `npm run build` — passed; `git diff --check` — passed. PostgreSQL migration/integration proof and high-risk independent/native review remain pending.
- L6 (2026-11-03): Created a separate local `erp_logistic_test` database (left the existing `erp_logistic` database untouched), applied all 18 migrations including the new sequences and Google Maps URL column, then ran the full suite with `DATABASE_URL` pointed only at that test database. Result: 446 passed, 1 skipped; the skipped test is the MinIO/object-storage integration test, not PostgreSQL. PostgreSQL-backed fixtures cleaned their tenant rows; verified test DB has 0 organizations, 0 customers and 0 delivery orders, with 18 migration records and both code sequences plus `google_maps_url` present. Independent high-risk/native review remains pending.
- L7 (2026-11-03): User requested launching containers with the new changes. The first migrations-container attempt hit a host port-5432 collision and left this project's PostgreSQL container stopped; restored it on its prior host port 15532 without removing/recreating volumes or touching the other PostgreSQL container. Applied both pending migrations to the existing local `erp_logistic` database. Rebuilt and recreated only API/web with ports 13001/8080, leaving other services and volumes intact. API `/healthz` and web `/` both return HTTP 200; all Compose services report running. Native/independent review is still pending.
