# Planning rules

1. Only ADMIN or DISPATCHER may create a route. Organization and actor come
   from a verified JWT, never request data.
2. A route has a unique readable code per organization, a planned date, one
   active driver, one active vehicle, and at least one stop. Stop sequences are
   unique positive integers. Each stop has an address and at least one order;
   coordinates must appear together when provided.
3. Each selected order must belong to the same organization, be `created`,
   and not already belong to an active route. An order may appear only once
   within a route, even across stops.
4. Creating a route assigns its orders. Each transition
   `created → planned → assigned` has its own actor-bound history row in the
   same transaction. No delivery attempt or confirmation occurs here.
5. Rejected commands leave route, stops, links, orders and history unchanged.
   Foreign and unknown orders have the same 404 response; duplicate assignments
   and unavailable resources are conflicts.

The original plan calls for reassignment and redespacho later in Phase 3.
`returned` is currently terminal; its re-entry policy is an open product
decision, not a hidden automatic retry.
