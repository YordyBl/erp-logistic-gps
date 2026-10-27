# Local planning decisions

| Decision | Rationale | Revisit |
|---|---|---|
| Require driver and vehicle when planning | The approved conceptual model requires exactly one of each per route; avoid inventing a draft route state. | Reassignment unit |
| Audit both order transitions in one transaction | The existing policy allows `created → planned → assigned`, never a direct jump; every status change is audited. | Route progress |
| Keep route coordination in process infrastructure | Cross-module repositories do not call one another. A unit of work must atomically update route, stop and order storage. | General unit-of-work abstraction if another flow needs it |
| Unique active assignments and tenant-scoped foreign keys | Validation alone cannot protect against concurrent plans or accidental cross-tenant links. | Redespacho policy |

The meaning of a new dispatch after `returned` remains open and is not
implemented here. Delivery execution and GPS belong to later phases.
