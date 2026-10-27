# Route planning HTTP contract

`POST /api/v1/delivery-routes` requires a JWT role ADMIN or DISPATCHER and a
strict JSON body with `publicCode`, `plannedDate` (`YYYY-MM-DD`), `driverId`,
`vehicleId`, and non-empty `stops`. A stop supplies positive `sequence`,
`addressLine`, non-empty `orderIds`, and either both `latitude`/`longitude` or
neither. The organization and actor are taken from the verified token.

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

No route-list, editing of stops, redespacho, execution or tracking endpoint
is claimed by the planning slice. OpenAPI remains the machine-readable source.
