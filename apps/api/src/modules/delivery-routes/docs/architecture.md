# Route planning architecture

The `PlanRouteUseCase` validates external input and consults the driver and
vehicle catalog **application** contracts, not their repositories. The shared
composition root chooses an in-memory test adapter or the production
`RoutePlanningTypeOrmStore`. `GetRouteUseCase` reads only the tenant-bound
projection; neither use case imports TypeORM or Express.

The production store lives under process-wide infrastructure because it is a
cross-module unit of work: route, stop, stop-order links, order status and order
audit must commit or roll back together. It locks driver/vehicle rows and order
rows (in sorted order), checks active status and organization inside the
transaction, then inserts all related records. Unique active-assignment indexes
and composite tenant foreign keys backstop concurrent or direct database writes.

The in-memory adapter stages every order transition before publishing any
change and is used only for HTTP/unit tests; PostgreSQL is the durability and
concurrency authority. Route execution and GPS are outside this slice.
