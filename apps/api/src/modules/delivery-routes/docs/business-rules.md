# Planning rules

1. Only ADMIN or DISPATCHER may create a route. Organization and actor come
   from a verified JWT, never request data.
2. A route has a unique readable code per organization, a planned date, one
   active driver, one active vehicle, and at least one stop. Stop sequences are
   unique positive integers. Each stop has an address and at least one order;
   coordinates must appear together when provided.
3. Each selected order must belong to the same organization, be `created` or
   `returned`, and not already belong to an active route. An order may appear
   only once within a route, even across stops. Redispatching a returned order
   is a new dispatcher decision; its prior route and status history remain
   available, and its previous active order link is deactivated atomically.
4. Creating a route assigns its orders. Each transition has its own actor-bound
   history row in the same transaction: `created → planned → assigned` for a
   first dispatch, or `returned → planned → assigned` for redispatch. No
   delivery attempt or confirmation occurs here.
5. A planned route may be reassigned to another active driver or vehicle while
   it remains `planned`. Reassignment never touches stops, links, order
   statuses or history, and a driver/vehicle cannot be active on two routes at
   once.
6. Rejected commands leave route, stops, links, orders and history unchanged.
   Foreign and unknown orders have the same 404 response; duplicate assignments
   and unavailable resources are conflicts.

The dispatcher UI must show the recorded `returned` history event as an
incident marker before redispatch. Category and description are not part of the
order status-history contract and must not be inferred from that event.
