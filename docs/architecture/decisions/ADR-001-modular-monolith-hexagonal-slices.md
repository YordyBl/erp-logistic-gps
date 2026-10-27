# ADR-001: Modular monolith with hexagonal architecture and vertical slices

- **Status:** Accepted
- **Date:** 2026-10-26
- **Deciders:** Engineering, architecture plan v0.2
- **Supersedes:** none

## Context

The platform is a last-mile delivery ERP for Lima Metropolitana and Callao. The MVP
covers customer accounts, delivery orders with recipient data, routes with multiple
stops and multiple orders per stop, driver and vehicle assignment, simulated GPS
tracking, delivery execution with photo evidence and incidents, public per-order
tracking, and operational dashboards. It is delivered by a small team on a short
timeline, so the architecture must keep the deployment simple while protecting the
business rules that are hardest to change later: tenancy boundaries, order/route
assignment, delivery confirmation, evidence handling and auditability.

A distributed system would add operational cost without a demonstrated scaling need.
A single layered application would instead let framework and persistence details leak
into the rules that matter. The ratified decision (architecture plan sections 2 and 3)
is a modular monolith with hexagonal architecture and vertical slicing by use case.

## Decision

### 1. One deployable, strictly bounded modules

The API is a single Node.js + Express + TypeScript process. Inside it, code is split
into modules aligned with business capabilities: `identity-and-access`, `customers`,
`delivery-orders`, `delivery-routes`, `dispatch`, `drivers`, `fleet-management`,
`delivery-execution`, `live-tracking` and `public-tracking`.

Each module owns its domain model, use cases, persistence adapters, HTTP adapters and
tests. A module is the unit of ownership: one module's repository, entities and tables
are never reached directly from another module. Cross-module coordination happens
through application contracts (ports) or domain/application events.

### 2. Hexagonal layering inside every module

Every module has three layers:

| Layer | Contents | May depend on |
|---|---|---|
| Domain | Aggregates, entities, value objects, domain events, policies, typed errors | Nothing external (no Express, TypeORM, HTTP clients, SDKs) |
| Application | Use cases, commands/queries, ports, output contracts, validation | Domain and its own ports |
| Infrastructure | Express controllers, TypeORM entities/repositories, messaging adapters, external services | Application ports, domain types, framework libraries |

Dependencies point inward. Use cases depend on interfaces, never on concrete adapters.
Adapters are supplied at runtime by composition.

### 3. Vertical slicing by use case

A slice is the smallest deliverable unit and groups everything one use case needs:
command or query, use case, runtime validation, the ports it uses, its tests and its
output contract. Slices live under `application/use-cases/<use-case-name>/` with
`CommandOrQuery.ts`, `UseCase.ts` and `Result.ts`. Ports shared by several slices stay
in `application/ports/`.

### 4. Architecture rules (ratified)

1. The domain layer imports no Express, TypeORM, HTTP libraries or external services.
2. Use cases depend on ports/interfaces, never on concrete adapters.
3. TypeORM lives exclusively in infrastructure; its entities are kept separate from
   domain aggregates.
4. A slice bundles command/query, use cases, validation, required ports, tests and the
   output contract. Module-wide shared ports remain in `application/ports` when useful.
5. Dependency composition happens in a composition root.
6. Direct access between repositories of different modules is forbidden. Coordination
   happens through application contracts or events.
7. Strict TypeScript: `strict`, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`;
   explicit `any` is prohibited by ESLint.
8. Validate every external input at runtime. TypeScript types do not replace HTTP
   validation.
9. Typed domain errors; a central error middleware and consistent HTTP status codes.
10. Use transactions for operations that change order, stop and route in a coordinated
    way.
11. English semantic names for code, database, endpoints and architecture documents.
    The user interface is in Spanish.
12. UUID internal identifiers; readable public codes kept separate from identifiers and
    tracking tokens.

Rules 7-12 are already encoded in the repository foundations: `tsconfig.base.json`,
`eslint.config.js`, ADR-002 (persistence), ADR-003 (auth/tracking tokens) and
`docs/architecture/data-model.md` (identifiers and public codes).

### 5. Module template

```text
module-name/
├── domain/
│   ├── entities/
│   ├── value-objects/
│   ├── events/
│   ├── policies/
│   └── errors/
├── application/
│   ├── ports/
│   └── use-cases/
│       └── use-case-name/
│           ├── CommandOrQuery.ts
│           ├── UseCase.ts
│           └── Result.ts
├── infrastructure/
│   ├── persistence/
│   ├── http/
│   └── messaging/
├── composition/
├── tests/
└── docs/
    ├── README.md
    ├── architecture.md
    ├── business-rules.md
    ├── data-model.md
    ├── api-contracts.md
    └── decisions.md
```

Empty folders are not created ahead of need. The template defines where code goes, not
a quota of files.

### 6. Composition root

`apps/api/src/infrastructure` holds process-wide adapters: configuration, the TypeORM
data source and migrations runner, the Express server, logging, object storage and
clock/id providers. Each module exposes a `composition/` factory that receives those
adapters and returns its controllers and use cases wired to module ports.

`apps/api/src/main.ts` is the composition root: it builds infrastructure once, composes
each module with its factory, mounts module routers and starts the process. Nothing
inside domain or application constructs its own dependencies. There is no service
locator.

### 7. Required documentation per module

Every module ships, next to its code:

| Document | Content |
|---|---|
| `README.md` | Responsibility, scope, limits, dependencies and scenarios |
| `architecture.md` | Components, ports/adapters, dependencies, Mermaid diagrams (C4/sequence when relevant), transactions and events |
| `business-rules.md` | States, invariants, decisions, validations, edge cases and examples |
| `data-model.md` | Domain entities, value objects, DTOs, persistence, nullability, enums, indexes, constraints and data dictionary |
| `api-contracts.md` | Endpoints, request/response, errors, JWT/permissions, filters, pagination and examples; OpenAPI is the source of truth for HTTP |
| `decisions.md` | Local ADRs, justifications and risks |

Tests are part of the module definition of done: domain/unit tests, PostgreSQL
integration tests, HTTP tests and authorization tests. Definition of done requires
typed code, passing lint and tests, a generated and tested migration when applicable,
documented API, documented business rules and a working Docker build.

## Consequences

**Positive**

- Business rules stay independent from Express, TypeORM and transport concerns, so they
  can be tested without a database or HTTP server.
- Module boundaries make ownership explicit and contain the blast radius of changes.
- Use-case slices give reviewers a small, self-contained unit to reason about.
- Adapters can change (persistence, object storage, GPS provider) without touching the
  domain.

**Negative / trade-offs**

- More files and indirection per feature than a layered CRUD application.
- Domain-to-persistence mapping is manual and must stay honest; see ADR-002.
- Boundaries are only real if enforced in review and CI; import-boundary linting and
  architecture tests are a follow-up, not part of this milestone.
- Cross-module flows require explicit contracts/events instead of convenient joins.

**Follow-ups**

- Add dependency-boundary checks (`eslint-plugin-boundaries` or
  `import/no-restricted-paths`) once the first modules exist.
- Publish the module documentation template so every module starts complete.
- Define the event transport guarantees before the first cross-module event is emitted
  (architecture plan section 11.11).
