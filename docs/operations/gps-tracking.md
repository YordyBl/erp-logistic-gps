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
stops. Single-delivery simulated routes are marked delivered and completed atomically when a
recorded simulated position reaches the destination. The attempt notes identify the result as
simulated and state that no physical confirmation or photo was collected; ordinary driver
confirmations still require their available evidence. This behavior requires an explicit
`simulatedCompletionEnabled: true` route-plan setting; only opted-in routes receive simulated GPS, and existing routes default to false. Current driver coordinates come from the
selected position source and may differ from that geometry; a driver can use Google Maps or
another navigation app without changing GPS ingestion.

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

During route scheduling, an optional HTTPS Google Maps share link can be added to each stop.
The API resolves short links through a limited number of manually validated redirects to
Google Maps hosts, extracts the place coordinates, and persists those coordinates with the
stop. Unsupported hosts, non-HTTPS links, unresolved redirects, and links without coordinates
reject route creation. Do not include private or credential-bearing URLs.

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
