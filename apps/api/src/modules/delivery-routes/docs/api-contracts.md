# Route planning HTTP contract

`POST /api/v1/delivery-routes` requires a JWT role ADMIN or DISPATCHER and a
strict JSON body with an optional `publicCode`, `plannedDate` (`YYYY-MM-DD`), `driverId`,
`vehicleId`, and non-empty `stops`. A stop supplies positive `sequence`,
`addressLine`, non-empty `orderIds`, and either both `latitude`/`longitude` or
neither. The organization and actor are taken from the verified token.
When `publicCode` is omitted the API generates the next code from the global
`delivery_route_public_code_seq` sequence, formatted as `RUT-00000001`; the
web planner always omits it.

```json
{
  "publicCode": "LIMA-ROUTE-001",
  "plannedDate": "2026-10-27",
  "driverId": "33333333-3333-4333-8333-333333333333",
  "vehicleId": "44444444-4444-4444-8444-444444444444",
  "stops": [{
    "sequence": 1, "addressLine": "Av. Arequipa 1234",
    "orderIds": ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]
  }]
}
```

`201` returns `{ "data": <route> }`, including its ID, normalized code,
`planned` status, driver/vehicle IDs and ordered stops; `Location` points to
`GET /api/v1/delivery-routes/{routeId}`. Every authenticated role may GET a
route belonging to its organization. Foreign and unknown route IDs return
the same 404.

`PATCH /api/v1/delivery-routes/{routeId}` requires ADMIN or DISPATCHER and a
strict body carrying `driverId`, `vehicleId` or both. Reassigning resources
never changes stops, links, order statuses or audit history. The new resource
must be active, in the caller's organization and not already assigned to
another active route.

| Status | Meaning |
|---|---|
| 400 | Invalid path/body, duplicate order IDs or stop sequences |
| 401 | Missing/invalid access token |
| 403 | Insufficient role for planning |
| 404 | Unknown or foreign driver, vehicle, order or route |
| 409 | Duplicate active assignment, used route code, inactive resource or non-created order |

For `PATCH`, 409 also covers a driver or vehicle already active on another
route; reassignment is allowed only while the route is `planned`.

## `GET /api/v1/delivery-routes`

ADMIN or DISPATCHER. Lists one page of the organization's planned,
in-progress and completed routes (cancelled routes are never listed), each one
a full route DTO with its ordered stops; stops and links are loaded only for
the page's routes. Offset pagination with total.

| Parameter | Meaning |
|---|---|
| `page` | 1-based, default `1`. A page past the end returns `data: []` with the real `total`. |
| `pageSize` | `1`–`100`, default `20`. |
| `q` | Case-insensitive substring over the route `publicCode`, the driver's full name and the vehicle plate (same organization). Trimmed; `%` and `_` match literally. |
| `sort` | `publicCode`, `plannedDate` or `status`, with `:asc`/`:desc` (bare field = ascending). Default `plannedDate:desc`; `createdAt` then `id`, in the same direction, break ties. |
| `status` | Comma-separated `planned`, `in_progress`, `completed`. |
| `ids` | Comma-separated route UUIDs (max 200). Foreign ids simply do not match. |
| `driverId`, `vehicleId` | One UUID each. |
| `plannedFrom`, `plannedTo` | Inclusive `YYYY-MM-DD` bounds on `plannedDate`; `plannedTo` may not precede `plannedFrom`. |

Filters combine with AND. Response `200`:

```json
{
  "data": [<route>, ...],
  "meta": {
    "page": 1, "pageSize": 20, "total": 12,
    "counts": { "status": { "planned": 4, "in_progress": 1, "completed": 7 } }
  }
}
```

`counts.status` applies `q` and every filter except `status`, and lists every
status with `0` when nothing matches. Unknown parameters, a sort outside the
whitelist, `pageSize > 100`, an unknown status or a malformed id or date return
`400 DELIVERY_ROUTE_INVALID_INPUT` with `details.issues` (`path`, `message`).

## `GET /api/v1/vehicles/route-stats`

ADMIN or DISPATCHER. Per-vehicle route aggregates for the fleet screen,
computed in SQL (`VehicleRouteStatsTypeOrmQuery`); only planned, in-progress
and completed routes count. `months` (`1`–`12`, default `6`) sets the length of
the monthly series, which ends with the current month in America/Lima and
groups routes by planned month. Every vehicle of the organization is listed,
with zeros when it never had a route.

```json
{ "data": [{
  "vehicleId": "44444444-4444-4444-8444-444444444444",
  "routes": 3, "completed": 2, "stops": 7, "orders": 8, "lastRouteDay": "2026-11-06",
  "monthly": [{ "month": "2026-06", "routes": 0 }, "...", { "month": "2026-11", "routes": 2 }]
}] }
```

`orders` counts every order link of the vehicle's routes (an order replanned
after a return counts on each route that carried it). Invalid or unknown
parameters return `400 VEHICLE_INVALID_INPUT`.

No editing of stops, redespacho, execution or tracking endpoint is claimed by
the planning slice. OpenAPI remains the machine-readable source.
