---
name: clean-architecture
description: Use when designing service structure, reviewing layer boundaries and dependency direction, deciding where business logic belongs, judging whether an abstraction or interface is architecturally justified, resolving whether a use case may return an ORM entity or read an HTTP request, naming or placing ports and adapters, or deciding whether a project is worth layering at all.
---

# Clean Architecture

Clean Architecture is one rule plus its consequences. The rule is about **source-code dependency
direction**, not about folder names. A codebase with `domain/`, `usecase/`, `adapter/`,
`infrastructure/` directories and an import from `domain` to the ORM has no clean architecture;
a flat codebase where nothing in the business logic imports a framework has most of it.

Judgment, not ceremony: the layering costs indirection and mapping code every day, and it must buy
something back — the ability to change a detail (database, framework, transport, vendor) without
touching business rules. When it does not buy that, do not pay for it (see *When not to apply*).

## The Dependency Rule

**Source dependencies point inward only. Nothing in an inner circle knows anything about an outer
circle** — not its names, its types, its functions, its data formats.

```
     ┌───────────────────────────────────────┐
     │ Frameworks & Drivers (details)        │  DB, HTTP server, ORM, SDKs, UI
     │  ┌─────────────────────────────────┐  │
     │  │ Interface Adapters              │  │  controllers, presenters, repo impls
     │  │  ┌───────────────────────────┐  │  │
     │  │  │ Use Cases (app rules)     │  │  │  orchestration, ports
     │  │  │  ┌─────────────────────┐  │  │  │
     │  │  │  │ Entities            │  │  │  │  enterprise rules
     │  │  │  └─────────────────────┘  │  │  │
     │  │  └───────────────────────────┘  │  │
     │  └─────────────────────────────────┘  │
     └───────────────────────────────────────┘
             source dependencies →  inward
```

The rule is mechanically checkable: read the import block of any file in an inner layer. If it
names something outer, that is a violation regardless of how well the code reads. Enforce it with
an import linter rather than review discipline — the rule is mechanical, so automate it and save
review attention for the judgment calls below.

Control flow *does* cross outward (a use case triggers a database write). Dependency inversion is
what lets control flow outward while source dependencies still point inward.

## Layer responsibilities

**Entities — enterprise business rules.** Rules that would be true even if this application did not
exist: an account balance cannot go negative, an invoice total is the sum of its lines. Pure data +
behavior, no I/O, no annotations from persistence frameworks, no knowledge of who calls them.

**Use cases — application-specific rules.** What *this* application does with those entities: load
these, call this rule, save the result, emit this event. **Orchestration without business rules
leaking in.** The test: if a branch inside a use case expresses a domain rule ("if the customer is
premium, waive the fee"), it belongs on an entity; if it expresses an application step ("if the
record does not exist, return NotFound"), it belongs in the use case.

**Interface adapters — translation only.** Controllers turn transport input into use-case input;
presenters turn use-case output into a view model; repository implementations turn domain objects
into rows and back. Nothing here decides anything about the business.

**Frameworks & drivers — details.** The web framework, the ORM, the message broker, the cloud SDK.
Details are chosen late and replaced without the inner layers noticing. If replacing your ORM would
require editing entities, the ORM was not a detail — it was your model.

## Crossing boundaries

**Data crossing a boundary is a simple structure the inner layer owns.** A use case defines its own
input and output types; the controller fills the input, the presenter consumes the output.

**Returning an ORM entity (or a DB row struct) from a use case is a violation**, even when it is
convenient and the fields happen to match. It makes every consumer depend on the persistence
schema; a column rename becomes an API change, and lazy-loading proxies escape into the transport
layer where the session is already closed.

Where the mapping tedium is worth it, and where it is not:

| Situation | Call |
|---|---|
| Domain entity → persistence row | Map. This is the boundary the whole design exists to protect |
| Use case output → HTTP/gRPC response | Map. Transport shape and application shape change for different reasons |
| Use case input → its own DTO, in a service with one transport and no plan for another | Often over-engineering. A single input struct owned by the use case is enough; a second identical DTO per layer buys nothing |
| Read-only query for a screen | Mapping through entities is usually waste. A dedicated read model that goes straight to a query service is legitimate, not a violation |

The honest test for a mapping layer: name the change it will absorb. "We will swap Postgres for
DynamoDB", "this vendor's API will be replaced". If no such change is plausible, the mapping is
ritual.

## Dependency inversion in practice

**Ports are defined by the inner layer and implemented by an outer one.** The interface lives next
to its *consumer*, not next to its implementation, and it is named for what the consumer needs.

```go
// GOOD: the use-case package owns the port, in its own vocabulary
package usecase

type OrderRepository interface {
    FindByID(ctx context.Context, id domain.OrderID) (*domain.Order, error)
    Save(ctx context.Context, o *domain.Order) error
}

// The infrastructure package imports usecase to implement it — dependency points inward.
```

```go
// BAD: the interface lives with the implementation and leaks it
package postgres

type OrderStore interface {
    QueryRow(ctx context.Context, sql string, args ...any) (*OrderRow, error) // SQL in the port
}
```

**When a single-implementation interface is justified:** at an architectural boundary — a port to
the database, an external service, the clock, the filesystem, a message bus. There, the interface
expresses "this is a detail that may change or must be substituted in tests", and one
implementation today is fine.

**When it is cargo cult:** inside a layer. An interface for every service and every entity helper,
each with exactly one implementation and a name that is the class name plus `I` or `Interface`, is
indirection with no substitution behind it. It makes navigation worse and buys nothing. Delete it
and depend on the concrete type; extract the interface when the second implementation (or a real
testing need) actually arrives.

## Common violations

| Violation | How it looks | Why it matters |
|---|---|---|
| Domain imports infrastructure | ORM tags, `database/sql`, framework annotations on entities | The model is now the schema; changing storage changes business rules |
| Use case reads the transport object | `func (u *UseCase) Do(r *http.Request)` | The use case is unusable from a CLI, a queue consumer, or a test without a fake request |
| Controller with business branching | `if order.Total > limit { … }` in the handler | The rule is invisible to the domain and gets re-implemented at the next entry point |
| Anemic use case | Method body is one call: `return u.repo.Save(x)` | Adds a layer with no application rule in it. Either the rule is missing (it leaked outward) or this layer is unnecessary here |
| Entity depending on a use case | Entity calls back into orchestration | Dependency cycle; the inner layer now knows the application |
| DTO chain with no transformation | Four structurally identical structs, one per layer | Pure cost. Collapse to the ones that absorb a real change |

The anemic use case deserves special attention in review: it is the most common symptom of business
logic that has drifted into controllers or repositories. Before deleting the layer, look for the
missing rule — it is usually somewhere outward of where it belongs.

## When not to apply

Layering must buy real change-isolation. Skip or thin it for:

- **Scripts and one-off tooling.** The cost of a boundary is never recovered.
- **Prototypes and spikes** whose purpose is to be thrown away. Layering a spike slows down the
  learning it exists to produce.
- **CRUD-only services** with no rules beyond validation. Entities with no behavior plus use cases
  that forward to repositories is Clean Architecture's shape with none of its substance — a
  handler talking to a query builder is more honest and easier to change.
- **Small services with one transport, one datastore, and no plausible substitution.**

Reasonable middle ground: keep the Dependency Rule (business logic imports nothing from frameworks)
and drop the ceremony (per-layer DTOs, interfaces with one implementation). The rule is cheap; the
ceremony is not.

Introduce full layering when: rules outlive any one delivery mechanism; there is more than one
entry point (HTTP + queue + batch); the storage or a vendor is genuinely likely to change; or the
domain logic has grown past what can be tested through the transport.

## Relation to DDD

The two overlap but answer different questions. Clean Architecture answers *which direction may
dependencies point*; DDD answers *what the model should be*.

- Entities layer ≈ DDD's tactical model (aggregates, entities, value objects, domain services).
- Use cases ≈ DDD's application services — orchestration, transactions, no domain rules.
- Interface adapters ≈ repository implementations and the anti-corruption layer at a context seam.
- Clean Architecture has nothing to say about bounded contexts or ubiquitous language; those are
  strictly DDD's, and they are the decisions that matter more.

For aggregate boundaries, value objects, domain events, and context mapping, see the
`ddd-modeling-review` skill (ddd pack).
