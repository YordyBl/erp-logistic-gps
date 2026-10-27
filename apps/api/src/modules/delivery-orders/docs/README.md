# `delivery-orders` module

The module owns the delivery-order aggregate: what an order is, which invariants it must
keep, how an operator creates one, and how an authenticated organization reads one. It is
the pilot for the repository's modular-monolith and hexagonal conventions.

**Status:** application and domain layers implemented, with unit tests and an in-memory
composition root. HTTP adapters, PostgreSQL/TypeORM persistence, authentication wiring and
delivery execution (confirm delivery, incidents) are later milestones.

## Quick path

1. Read the business rules in [business-rules.md](business-rules.md).
2. Inspect the layer boundaries in [architecture.md](architecture.md).
3. Run the module tests from the repository root: `npm test`.
4. Type-check and lint: `npm run typecheck` and `npm run lint`.

## Responsibility

| In scope | Out of scope (for now) |
|---|---|
| `DeliveryOrder` aggregate and its value objects (`Recipient`, `DeliveryAddress`, `Package`) | HTTP controllers, request routing and OpenAPI |
| Creating an order with validated recipient, address and packages | TypeORM entities, repositories and migrations |
| Reading an order inside the authenticated organization | Authentication/JWT middleware and RBAC |
| Per-organization public-code uniqueness check | Server-side public-code sequences |
| Order-side status vocabulary and transition policy | `confirm-delivery`, incident reporting and evidence flows (`delivery-execution`) |
| `DeliveryOrderCreated` domain event | Cross-module event transport, outbox and replay guarantees |

## Boundaries and dependencies

- Depends only on Node.js built-ins (`node:crypto`) and Zod at the application boundary.
- The domain imports no Express, TypeORM, HTTP client or Zod code (ADR-001 rule 1).
- Use cases depend on the `DeliveryOrderRepository`, `IdGenerator`, `Clock` and
  `EventPublisher` ports; adapters are supplied by
  [composition/composition-root.ts](../composition/composition-root.ts).
- No other module imports this module's repository or domain. Future cross-module work
  goes through application contracts or events (ADR-001 rule 6).
- The module is not mounted in `apps/api/src/main.ts` yet: there is no HTTP transport in
  this milestone.

## Scenarios

| Scenario | Use case | Result |
|---|---|---|
| A dispatcher creates an order with two parcels | `CreateDeliveryOrderUseCase` | Order stored in `created` status and `DeliveryOrderCreated` published |
| The same organization repeats a public code | `CreateDeliveryOrderUseCase` | Invariant error; nothing stored or published |
| A dispatcher reads an order from their organization | `GetDeliveryOrderUseCase` | Order DTO returned |
| A user from another organization guesses an order id | `GetDeliveryOrderUseCase` | Forbidden error, no order data returned |
| An order id does not exist | `GetDeliveryOrderUseCase` | Not-found error |

## Code map

```text
delivery-orders/
├── domain/
│   ├── entities/DeliveryOrder.ts
│   ├── value-objects/{Recipient,DeliveryAddress,Package}.ts
│   ├── events/{DomainEvent,DeliveryOrderCreated}.ts
│   ├── policies/DeliveryOrderStatusPolicy.ts
│   └── errors/DeliveryOrderError.ts
├── application/
│   ├── dto/DeliveryOrderDto.ts
│   ├── ports/{DeliveryOrderRepository,IdGenerator,Clock,EventPublisher}.ts
│   └── use-cases/
│       ├── create-delivery-order/{CreateDeliveryOrderCommand,CreateDeliveryOrderUseCase,CreateDeliveryOrderResult}.ts
│       └── get-delivery-order/{GetDeliveryOrderQuery,GetDeliveryOrderUseCase,GetDeliveryOrderResult}.ts
├── composition/composition-root.ts
├── tests/
└── docs/
```

## Production adaptation checklist

- [ ] Replace the in-memory repository with the TypeORM adapter and a reviewed migration.
- [ ] Generate public codes from a per-organization sequence instead of trusting a caller.
- [ ] Populate `organizationId` from validated JWT claims in the HTTP adapter.
- [ ] Publish `DeliveryOrderCreated` through the ratified event transport/outbox.
- [ ] Add HTTP contracts to the OpenAPI document and authorization tests per role.

## Documentation

| Document | Content |
|---|---|
| [architecture.md](architecture.md) | Layers, ports/adapters, sequence diagram, events and composition |
| [business-rules.md](business-rules.md) | Statuses, transitions, invariants, validations and edge cases |
| [data-model.md](data-model.md) | Aggregate, value objects, DTO and persistence intent |
| [api-contracts.md](api-contracts.md) | Proposed HTTP endpoints, payloads and error mapping |
| [decisions.md](decisions.md) | Module-level decisions, trade-offs and risks |
