# `delivery-orders` module

The module owns the delivery-order aggregate: what an order is, which invariants it must
keep, how an operator creates one, and how an authenticated organization reads one. It is
the pilot for the repository's modular-monolith and hexagonal conventions.

**Status:** domain, application, HTTP and PostgreSQL/TypeORM persistence are implemented.
The module is mounted at `/api/v1/delivery-orders` by `apps/api/src/main.ts`; migrations
live in `apps/api/migrations` and the HTTP contract in `docs/api/openapi.yaml`.
Authentication wiring (JWT) and delivery execution (confirm delivery, incidents) are later
milestones.

## Quick path

1. Read the business rules in [business-rules.md](business-rules.md).
2. Inspect the layer boundaries in [architecture.md](architecture.md).
3. Run the module tests from the repository root: `npm test`.
4. Type-check and lint: `npm run typecheck` and `npm run lint`.

## Responsibility

| In scope | Out of scope (for now) |
|---|---|
| `DeliveryOrder` aggregate and its value objects (`Recipient`, `DeliveryAddress`, `Package`) | Authentication/JWT middleware and RBAC |
| Create/read use cases, Zod validation and Express routes under `/api/v1/delivery-orders` | Server-side public-code sequences |
| TypeORM entities, repository adapter and the initial migration | `confirm-delivery`, incident reporting and evidence flows (`delivery-execution`) |
| Per-organization uniqueness pre-check plus database-constraint translation to a 409 invariant | Cross-module event transport, outbox and replay guarantees |
| Order-side status vocabulary and transition policy | JWT-based tenant resolution (a temporary header is used in Fase 0) |
| `DeliveryOrderCreated` domain event | — |

## Boundaries and dependencies

- The domain depends only on Node.js built-ins (`node:crypto`); the application boundary
  uses Zod for runtime validation.
- The domain imports no Express, TypeORM, HTTP client or Zod code (ADR-001 rule 1).
  TypeORM is confined to `infrastructure/persistence`; Express adapters live in
  `apps/api/src/http` (ADR-002).
- Use cases depend on the `DeliveryOrderRepository`, `IdGenerator`, `Clock` and
  `EventPublisher` ports; adapters are supplied by
  [composition/composition-root.ts](../composition/composition-root.ts). The process
  composes the TypeORM repository through `createDeliveryOrdersModuleFromDataSource`;
  tests compose the in-memory repository.
- No other module imports this module's repository or domain. Future cross-module work
  goes through application contracts or events (ADR-001 rule 6).
- The module is mounted in `apps/api/src/main.ts` at `/api/v1/delivery-orders`. HTTP tests
  build the same Express app with in-memory adapters, so routing, validation and error
  mapping are exercised without PostgreSQL.

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
├── infrastructure/persistence/
│   ├── entities/{DeliveryOrderEntity,DeliveryOrderPackageEntity}.ts
│   ├── mappers/DeliveryOrderMapper.ts
│   └── DeliveryOrderTypeOrmRepository.ts
├── tests/
└── docs/
```

Migrations live in `apps/api/migrations`. HTTP adapters live in `apps/api/src/http`
(routing, validation, error mapping) and are documented by `docs/api/openapi.yaml`.

## Remaining production adaptation

- [ ] Generate public codes from a per-organization sequence instead of trusting a caller.
- [ ] Populate `organizationId` from validated JWT claims; the temporary
      `x-organization-id` header in Fase 0 is not an authorization mechanism.
- [ ] Publish `DeliveryOrderCreated` through the ratified event transport/outbox.
- [ ] Add role-based authorization tests and keep the OpenAPI contract in sync with routes.

## Documentation

| Document | Content |
|---|---|
| [architecture.md](architecture.md) | Layers, ports/adapters, sequence diagram, events and composition |
| [business-rules.md](business-rules.md) | Statuses, transitions, invariants, validations and edge cases |
| [data-model.md](data-model.md) | Aggregate, value objects, DTO and persistence intent |
| [api-contracts.md](api-contracts.md) | Current HTTP endpoints, payloads and error mapping |
| [decisions.md](decisions.md) | Module-level decisions, trade-offs and risks |
