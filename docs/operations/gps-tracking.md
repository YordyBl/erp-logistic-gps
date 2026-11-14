# GPS tracking configuration

GPS positions are stored against an active delivery route. Simulated and future mobile
position sources share the same normalized contract; the road-routing engine is an
optional source of planned geometry and does not control the driver's navigation app.

| Environment variable | Default | Purpose |
|---|---:|---|
| `GPS_SIMULATION_INTERVAL_SECONDS` | `4` | Sampling interval; accepted range is 3–5 seconds. |
| `GPS_SIMULATION_TIME_SCALE` | `1` | Multiplies elapsed route time for simulated GPS; accepted range is 1–100. Keep `1` for real-time progression; larger values are for local demonstrations. |
| `GPS_POSITION_RETENTION_DAYS` | `30` | Configurable retention period for position history, measured using server receipt time. |
| `VALHALLA_URL` | unset | Base URL of a locally hosted Valhalla service. Enable the optional Compose setup below to supply `http://valhalla:8002`. When unavailable, route geometry and simulated positions are omitted. |
| `VITE_MAP_STYLE_URL` | `https://tiles.openfreemap.org/styles/bright` | Optional MapLibre style URL for the dispatcher control tower. The default uses OpenFreeMap; change it at web build time to use another compatible style source. |

The GPS simulator starts after the API database connection is initialized and stops during
graceful shutdown. Every tick prunes expired GPS history and samples active routes. Route
completion or the absence of an active delivery attempt prevents new positions from being
persisted. The 30-day retention policy applies only to GPS position history, not delivery
photos or order history.

Valhalla supplies optional planned route geometry and a duration estimate. A route may start
from a separately persisted origin; the simulator routes from that origin through its delivery
stops. Current driver coordinates come from the selected position source and may differ from
that geometry; a driver can use Google Maps or another navigation app without changing GPS
ingestion.

## Development-only route simulation

Route simulation exists only to demonstrate the system locally. It is enabled when **both**
conditions hold:

- `NODE_ENV` is set explicitly to `development`. An unset `NODE_ENV` does not enable it, even
  though the API otherwise defaults to development; `production`, `test` and any other value
  disable it.
- `VALHALLA_URL` is configured, because without geometry no position is produced and a
  simulated route would never close.

When simulation is disabled, planning rejects `simulatedCompletionEnabled: true` with 400, the
simulator samples no positions and completes nothing, and GPS retention pruning keeps running.

`GET /api/v1/delivery-routes/simulation` (ADMIN or DISPATCHER) returns
`{ enabled, eligibleDriverIds }`. The web planning page uses it to show the **Simular ruta**
checkbox, the origin address and Google Maps link fields, and to restrict the driver list. The
controls stay hidden when the endpoint reports `enabled: false` or fails.

A simulated route:

1. Uses only a driver **without a linked account**. Planning with a linked driver returns 409,
   and binding an account to a driver with a `planned` or `in_progress` simulated route also
   returns 409. Both checks run under the driver row lock.
2. Requires an origin, so even single-stop routes have a path to follow. Its stops always
   have coordinates because they are copied from the orders.
3. **Starts when planned**: in the planning transaction the route becomes `in_progress` with
   `startedAt`, its orders become `in_transit` with one `in_progress` attempt each, and order
   and route status history is written.
4. Records the planning dispatcher as the actor (`delivery_routes.simulation_actor_user_id`,
   added by migration `SimulatedRouteActor1794100000000`) on every simulated history row.
5. **Closes each stop by itself**. Reached stops are detected from progress along the geometry
   using Valhalla leg distances, so a tick that skips several stops closes all of them in order.
   Each reached stop's `in_transit` orders become `delivered` with a terminal attempt whose note
   says the result is simulated and that no physical confirmation or photo was collected;
   already-terminal orders are skipped. The route completes when every active order is
   terminal. Processing is idempotent and locks orders in `orderId` order.

Ordinary driver confirmations still require their available evidence; only opted-in routes
receive simulated GPS, and existing routes default to `simulatedCompletionEnabled: false`.

The Compose stack sets `NODE_ENV=development`, passes `GPS_SIMULATION_INTERVAL_SECONDS`
(default `4`) and uses `GPS_SIMULATION_TIME_SCALE=10` by default so a multi-stop demo route
closes in minutes. Starting it with `docker-compose.valhalla.yml` supplies `VALHALLA_URL`.
Override either value in `.env`.

## Local Peru routing service

The default development stack does not build or start Valhalla. To enable it, download the
public Peru OSM extract into the ignored local data directory, then start Compose with the
Valhalla override:

```sh
mkdir -p infra/valhalla/data
curl --fail --location --output infra/valhalla/data/peru-latest.osm.pbf \
  https://download.geofabrik.de/south-america/peru-latest.osm.pbf
docker compose -f docker-compose.yml -f docker-compose.valhalla.yml up --build
```

The override uses the pinned local Valhalla image and binds the service only to
`127.0.0.1:8002`. On first start, `infra/valhalla/start.sh` builds admin metadata and routing
tiles from the local extract, then starts the HTTP service; subsequent starts reuse the
generated graph. The PBF and generated graph files are ignored by Git. Building the Peru
graph can take several minutes and use multiple gigabytes of memory and disk. Use
`VALHALLA_BUILD_CONCURRENCY` to cap build threads (default `2`) and `VALHALLA_PORT` to change
the loopback host port. The application container waits for Valhalla's `/status` health check.

Every delivery order must carry coordinates (create, edit and import reject orders without
them), and every route stop is exactly one order: at planning time the stop copies the order's
delivery address and coordinates, so each planned route always has the geometry Valhalla and
the GPS simulator need. Stops accept no address, link or coordinates of their own.

Google Maps links are still supported in two places. The order form resolves an optional
HTTPS share link to coordinates before the order is created, and the origin of a simulated
route may be given as a link. The API resolves short links through a limited number of
manually validated redirects to Google Maps hosts and extracts the place coordinates.
Unsupported hosts, non-HTTPS links, unresolved redirects, and links without coordinates are
rejected. Do not include private or credential-bearing URLs.

## Authenticated live tracking

The dispatcher control tower renders route stops and the latest persisted GPS
positions with MapLibre GL JS. It uses OpenFreeMap's hosted vector style by default;
OpenFreeMap requires internet access and attribution, which the style provides.
The map distinguishes stored last-known positions from a live presence guarantee.
No ETA is displayed because its product policy is still undecided. Set
`VITE_MAP_STYLE_URL` before building the web app to replace the basemap style.

An authenticated client obtains a one-use WebSocket ticket with
`POST /api/v1/tracking/ticket` and its Bearer access token. The response is
`Cache-Control: private, no-store` and contains an opaque ticket that expires
after 30 seconds. The ticket is bound to the request's `Origin`, consumed during
the WebSocket upgrade, and the user's current active status, organization, and
role are reloaded before the connection is accepted. Do not log or retain the
ticket URL.

Connect to `/api/v1/tracking/socket?ticket=<ticket>`. The first message is a
role- and organization-scoped `snapshot` containing routes and each active
route's latest persisted GPS position. Reconnection always begins with a fresh
snapshot. Successful route/order changes and newly persisted positions send an
ordered `update` with a fresh authorized snapshot. Clients may request another
snapshot by sending `{"type":"snapshot"}`; other client messages close the
socket. Sequence numbers are process-local hints, not durable cursors. No event
replay is stored, so reconnecting clients must use the new snapshot rather than
expecting missed updates to be replayed. Driver snapshots contain only that
driver's assigned route; ADMIN and DISPATCHER snapshots are limited to their
organization.
