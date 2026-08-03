---
name: ddd-modeling-review
description: Use when reviewing or implementing a Domain-Driven Design codebase, deciding aggregate boundaries, value objects, entities, sum types, domain events, factories, repositories or domain services, when drawing or questioning a bounded context, integrating a legacy or external model (context mapping, anti-corruption layer, shared kernel), when code and expert vocabulary have drifted apart, when triaging how much modeling a subdomain deserves, or when a schema, tenant-isolation or error-taxonomy question has domain implications.
---

# DDD Modeling Review

Review and design judgment for Domain-Driven Design, organized the way Evans organized it:
**strategic design first** (where the model boundaries are, whose language wins, what deserves
modeling effort at all), **tactical design second** (aggregates, value objects, entities, events).

Most DDD failures are strategic mistakes wearing tactical clothes: an aggregate that cannot be
drawn cleanly usually means the bounded context is wrong, and elaborate tactical machinery inside a
generic subdomain is pure cost. Read Part I before arguing about Part II. Go is the primary example
language because DDD structure surfaces most clearly there; every principle is
language-independent.

Two habits underlie every point below:

- **Look at several existing patterns before deciding.** Do not conclude from a single example.
  Sweep every aggregate/table/handler of the same shape, learn the common form and the deviations,
  then form an opinion.
- **No cargo-culting.** "The existing code does it this way" is not a reason. Ask why it is that
  way from first principles and back it with an authoritative source (an architecture decision
  record, the datastore's official docs). Do not state a guess as a fact.

---

# Part I — Strategic design

## S1. Ubiquitous language

**Principle.** One language spans the model, the code, and the conversation. The word a domain
expert says out loud in a meeting is the word in the class name, the method name, the event name,
and the column name. If the three drift apart, the model has already stopped being the model.

**Why.** The value of a domain model is that a domain expert can read a discussion of the code and
correct it. Once engineers maintain a private vocabulary ("they call it an Order, internally we call
it a Transaction"), every requirement conversation becomes a translation exercise and translation
errors accumulate silently — nobody notices "cancel" meant two things until a refund goes out.

**A translation layer inside one team is a smell, not a design.** Translation *between* bounded
contexts is correct and has a name (Anti-Corruption Layer, S3); translation *within* one context
means two vocabularies are competing and neither has won. Drift signals worth raising in review:

| Signal | What it usually means |
|---|---|
| Code uses a synonym no expert ever says (`TransactionRecord` for what they call an invoice) | Engineering vocabulary leaked in — rename the code |
| Experts have a word the code cannot express (they say "provisional booking", the code has a bool) | A missing concept — the model needs a new type, not a flag |
| The same word means two things depending on caller | Two bounded contexts fused into one model (see S2) |
| Names ending in `*Info`, `*Data`, `*Manager`, `*Handler` in the domain layer | Nobody found the domain word yet; the name is a placeholder |

**Judgment when code and expert disagree.** Usually the code is wrong and should be renamed. But
sometimes modeling exposed a real distinction the expert's loose everyday word hid — two things
they both called "order". Then do not keep the distinction code-only: push the new words back into
the spoken language and get the expert to adopt them. A distinction that exists only in the
codebase decays within a quarter.

## S2. Bounded context

**Principle.** A bounded context is the scope inside which one model is coherent and one language
holds without qualification. It is a **linguistic and model boundary, not a deployment boundary**.
A single deployable service may host several bounded contexts; conversely, one context must never
be split across two services that have to be released together to stay correct.

**Why.** Teams routinely equate "microservice" with "bounded context" and draw boundaries by
infrastructure convenience — one service per table, one per on-call rotation. The result is a model
whose terms mean different things at different endpoints, exactly the failure bounded contexts
exist to prevent. Draw the boundary where the language changes; decide deployment separately.

**Signs a context is too big:** the same term needs a qualifier to be understood ("the billing
Customer, not the CRM Customer"); one shared "core"/"common" model package that every feature
imports and every team edits; nearly every feature touches the same aggregate; branching keyed on
*which caller* is asking rather than on domain state; nobody can state the context's invariants in
one paragraph.

**Signs a context is too small (over-split):** ordinary use cases need a distributed transaction or
a chatty chain of synchronous calls; an aggregate cannot be validated without calling another
context first; eventual consistency shows up where users perceive one atomic action.

**The judgment that decides it:** a context boundary is a place you are willing to be eventually
consistent and willing to translate. If you are not willing to accept either at some seam, that
seam is not a context boundary — it is inside one context.

## S3. Context mapping: choosing an integration pattern

**Principle.** Every relationship between two contexts is one of a small set of patterns, and the
pattern is a decision about **power and coupling**, not about protocol. Naming it explicitly is the
point: unnamed relationships default to the worst one (implicit shared model, mutual breakage).

| Pattern | Choose it when | Real cost / the usual regret |
|---|---|---|
| **Partnership** | Two teams genuinely succeed or fail together, can both change, and have aligned incentives and release cadence | Continuous coordination. Do not choose it merely because both teams are in the same company |
| **Shared Kernel** | A small, stable, genuinely shared core (money, identity primitives) with one named owner and an explicit change protocol | **You will almost always regret it.** The kernel accretes everything; "change only by agreement" degrades into whoever merges first. Default answer is no — duplicate the type instead |
| **Customer-Supplier** | The downstream's needs can really enter the upstream's backlog, with a prioritization channel that exists in practice | Fails silently when the "channel" is a Slack message the upstream team ignores. Then you are actually Conformist |
| **Conformist** | Upstream's model is good enough and translation cost exceeds coupling cost — typically a well-designed platform API | Accepting the coupling deliberately is fine; *drifting* into it is not. When upstream re-models, you re-model |
| **Anti-Corruption Layer** | **Default when integrating a legacy system or any external/third-party service** | A mapping layer you own and maintain. That cost buys you a domain that does not mutate when theirs does |
| **Open Host Service + Published Language** | More than about two consumers need the same integration; the protocol is versioned and documented independently of any one consumer | Premature with one or two consumers — you are designing for imagined generality |
| **Separate Ways** | The integration's cost exceeds the value of the shared feature | Chronically under-used. Some duplication is cheaper than a permanent seam |

**Anti-Corruption Layer is the default for foreign models** because the failure mode of skipping it
is invisible until it is expensive. Signs the ACL was needed and skipped:

```go
// BAD: the vendor's model has colonized the domain — its ids, its status vocabulary, its bag
type Customer struct {
    SfdcAccountId string
    Status        string
    CustomFields  map[string]any
}
if resp.ErrorCode == "INVALID_CROSS_REFERENCE_KEY" { /* vendor codes branching in a use case */ }

// GOOD: the boundary translates; the domain speaks only its own language
cust, err := s.crmACL.FetchCustomer(ctx, id) // returns a domain Customer, or a domain error
```

## S4. Subdomain triage: where modeling effort goes

**Principle.** Classify each subdomain before investing in it.

- **Core** — the reason the business wins. Invest the modeling effort here: best people, deepest
  refactoring, expect several rewrites as understanding deepens. Keep it in-house.
- **Supporting** — necessary but not differentiating. An adequate, simple model is correct.
  CRUD is an acceptable answer.
- **Generic** — already solved by the industry (authentication, billing, notification, scheduling,
  file storage). Buy, adopt, or wrap. Do not model it.

**Why this is the highest-leverage judgment in DDD.** Modeling effort is finite. Applying full
tactical machinery — aggregates, value objects, domain events, factories — to a generic subdomain
produces all of DDD's cost and none of its benefit, and is the single biggest reason DDD gets its
reputation for over-engineering.

**The triage test:** if a competitor did this exactly as well as we do, would we lose anything? If
no, it is not core. "Everything is core" is the most common triage failure — a refusal to choose
that spends the modeling budget on the parts that will never repay it. Practical consequence in
review: an elaborate sum type hierarchy inside a notification-preferences table is a finding; the
same hierarchy inside the pricing engine of a pricing company is the job.

---

# Part II — Tactical design

## 1. Layer responsibility

**Principle.** Domain decisions, invariants, and state transitions belong in the domain layer
(the entity / aggregate). Do not let them leak into application services, adapters, or
repositories. A handler does conversion and dependency injection only — it holds no business
branching.

**Why.** When a rule such as "one configuration per tenant" or "only in-progress items are
returned" lives in an adapter or service, the same rule gets re-implemented inconsistently in the
next call site, and the domain object no longer tells you what is true about it. Centralizing the
rule in one place is the completeness property of DDD; scattering it is how bugs and drift start.

```go
// BAD: an adapter carries the business rule "return only in-progress items"
func (a *adapter) ToResponse(rows []Row) *Response {
    filtered := filter(rows, func(r Row) bool {
        return r.Status == "in_progress" // domain decision leaked into the adapter
    })
    return toResponse(filtered)
}

// GOOD: the decision lives in the aggregate; the adapter only converts
inProgress := aggregate.InProgressItems()
return a.toResponse(inProgress)
```

- Do not write "if / for / switch" business branching in a handler. Convert through an explicit
  converter / DTO and wire dependencies manually.
- If storage / filesystem / environment access appears inside an application service, inject it at
  the handler or move it behind a client wrapper.
- Do not create an object literally named `service` inside the domain layer as a home for
  leftovers; a genuine domain service is named for its activity (section 7). Application services
  must not depend on one another.

## 2. Aggregate boundary

**Principle.** An aggregate is a **consistency boundary chosen for its invariants**, not a
convenient grouping of related data. Ask: "what must be true at the end of every single
transaction?" Everything that rule spans is one aggregate; everything else is outside it. An
aggregate has a single root entity (not a collection), and external code reaches only the root.

Three rules follow directly:

- **Reference other aggregates by identity**, never by object pointer. Holding `Order.customer
  *Customer` invites loading, mutating, and saving two aggregates at once.
- **One transaction modifies one aggregate.** Needing two in a transaction is the loudest available
  signal that the boundary is wrong (or that the two really are one aggregate).
- **Cross-aggregate consistency is achieved with domain events**, and it is eventual. If the
  business genuinely cannot tolerate eventual consistency between two things, they belong in the
  same aggregate — that is the trade you are making.

**Why.** Direct access across aggregates couples their lifecycles and destroys independent
evolvability — a schema change in one silently breaks the other. Grouping by "these fields feel
related" instead of by invariant produces aggregates that grow without limit: relatedness has no
natural boundary, invariants do.

```go
// BAD: aggregate A queries aggregate B's table/package directly
rows := s.db.Query(ctx, "SELECT ... FROM other_aggregate_table WHERE ...")
type Order struct { customer *Customer } // BAD: holding another aggregate by reference

// GOOD: reference by identity; read the other aggregate through its query interface
type Order struct { customerID CustomerID }
filters, err := s.otherAggregateQuery.ListByTenant(ctx)
// GOOD (cross-boundary): react to its event instead of reading across the boundary at all
```

- No cross-aggregate `Update`. Crossing a bounded context goes through the message bus.
- Keep the aggregate self-contained; do not give it a field (for example a `selection_kind`) that
  exists only to serve another aggregate's concern.
- A use case that must read across several aggregates belongs in a dedicated read model / view,
  not inside any one aggregate. Read models may span freely — the one-aggregate rule constrains
  *writes*.
- Do not mint a new aggregate for infrastructure convenience. Ask: "if nothing about this is
  persisted on its own, is it really an aggregate?"
- Prefer small aggregates. A large aggregate is a lock-contention machine; the usual cause is
  including data for query convenience rather than for an invariant.

## 3. Repository vs. query service

**Principle.** **One repository per aggregate root — never per entity or per table.** A repository
persists and restores aggregate roots only (`*Root` / `[]*Root`) plus the infrastructure mapping.
Partial views and purpose-built read models go to a separate query service. When nothing is found,
return a typed NotFound error, never `(nil, nil)`.

**Why.** A repository for a non-root entity is a hole punched in the aggregate boundary: callers
load and modify an interior object without the root's invariants ever running. Likewise, a
repository allowed to return header-only rows or a bespoke list model stops being the unit of
consistency and every caller invents its own shape. `(nil, nil)` forces every caller to remember to
nil-check and turns a missing row into a nil-pointer panic far from the cause.

```go
// BAD: a repository for an interior entity — bypasses the root's invariants
func (r *repo) GetOrderLine(ctx context.Context, id LineID) (*OrderLine, error)

// BAD: a repository method returns a partial / foreign model
func (r *repo) GetHeaders(ctx context.Context) ([]*ListItem, error)

// BAD: "not found" encoded as (nil, nil)
return nil, nil

// GOOD: optimized queries and purpose-built read models live in a query service
func (q *listQueryService) List(ctx context.Context, f Filter) ([]*ListItem, error)

// GOOD: missing row is an explicit typed error the caller can branch on
return nil, wrap(ErrNotFound)
```

- Keep generated / table-shaped structs out of the repository interface — expose domain types.
- Align one package = one aggregate = one access boundary so another aggregate cannot reach in.

## 4. Value object

**Principle.** Represent domain values as value objects that validate themselves at construction
(return an error on invalid input) and are immutable (unexported fields, no setter added later).
Identity is by value, not by id: two Money of 500 JPY are the same thing. Wrap a shared value
object per aggregate rather than reusing it raw, so it cannot be mixed up. Never serialize a value
object directly to JSON / DB / wire — go through an intermediate mapping. Expose only the getters
you actually need.

**Why.** A self-validating value object makes an invalid instance unrepresentable, so downstream
code never re-checks. Passing it by value (not pointer) removes the "someone passed nil" class of
bug entirely. Wrapping a shared type per aggregate stops a value meant for one aggregate from
being silently accepted by another. A getter that leaks the underlying primitive (`Int64()`)
invites callers to bypass the type; assistants love to add these — delete them. Prefer a value
object over an entity whenever the thing has no meaningful lifecycle of its own: modelling
something as an entity "because it has a row in the database" is backwards — persistence shape
follows the model, not the reverse.

```go
// BAD: pointer argument lets a caller pass nil into the domain
func NewEntity(soc *Money) *Entity

// BAD: a getter that leaks the raw representation; direct marshaling of the VO
func (m Money) Int64() int64

// GOOD: value receiver, unexported field, validated at construction, no setter
type Money struct{ value int64 } // immutable

func NewMoney(v int64) (Money, error) {
    if v <= 0 {
        return Money{}, wrap(ErrInvalidMoney)
    }
    return Money{value: v}, nil
}
```

- Defensively copy maps/slices; expose sets as first-class collections in signatures.
- Prefer a named getter that expresses intent over one that names the underlying type.

## 5. Entity and factory: construction, restore, invariants

**Principle.** An entity is defined by continuity of identity, not by its attributes. A **factory
exists when construction is itself domain knowledge** — when assembling a valid instance requires
rules a caller should not have to know. A `New*` constructor validates external input and returns
an error; it never panics. Only a `Must*` variant may panic (tests and self-evident literals). A
`restore` from the datastore always returns a valid entity, because the value was already valid
when stored. Generate the identifier and creation time inside the factory, not from arguments. Keep
fields unexported.

**Why.** If `New*` can panic, every caller must guard against a crash on ordinary bad input; an
error return makes the failure a normal, testable path. Constructor arguments typed as value
objects (not bare primitives, `bool` excepted) prevent the classic "two arguments swapped" defect.
Restoring only valid entities means the rest of the code never handles a half-built object.
**When a factory is *not* justified:** if construction is plain field assignment with no rule, it
hides nothing — `NewX(a, b, c)` that only sets a, b, c is ceremony. The factory earns its place when
it enforces an invariant, derives a field, or picks among variants.

```go
// BAD: New panics on bad input
func NewEntity(...) *Entity {
    if invalid { panic(...) }
}

// GOOD: New validates and returns an error; only Must may panic
func NewEntity(...) (*Entity, error) { /* ... */ }
func MustNewEntity(...) *Entity { /* tests / self-evident literals only */ }

// GOOD: restore trusts the store's invariant (document WHY)
func restore(row *Row) *Entity {
    // value was valid at store time, so parsing cannot fail here
    return &Entity{id: MustParseID(row.ID)}
}
```

- Do not include a field the entity has no reason to hold; never nil-fill "just in case."
- A mutable entity should return a new root rather than mutating its receiver in place; an
  append-only / immutable design is usually the more honest model for a persisted record.

## 6. Specification

**Principle.** A Specification is a predicate about an object — "is this eligible?" — lifted out of
scattered inline conditionals into a first-class object in the domain model. It exposes one method
(`IsSatisfiedBy(candidate) bool`) and composes with `And` / `Or` / `Not`.

**When it earns its place:**
1. The same business rule is needed in **validation**, **selection** (a query filter), and
   **construction** — one specification, three call sites, one place to change the rule.
2. Domain experts discuss and combine the rule out loud ("eligible for premium and not
   delinquent") — `And`/`Or`/`Not` composability mirrors the way they already talk, so the code
   reads as the sentence.
3. The rule varies by configuration or by tenant and must be swapped at runtime, not recompiled.

**When it is not justified.** A rule used in exactly one place is a method on the entity or value
object — a Specification there is ceremony, a type added for no reuse. A simple invariant ("amount
must be positive") belongs in the constructor/factory (section 5); Specification evaluates existing
instances or candidates, it is not a substitute for construction-time validation.

**The repository tension.** An in-memory Specification is trivial. A Specification passed into a
repository that must translate it into SQL is not — the repository now needs a general
predicate-to-query compiler, a leaky, half-built ORM living inside the domain layer. Judgment:
either (a) keep Specifications for in-memory/domain checks and let the repository expose
intention-revealing query methods (`FindDelinquent`) that happen to encode the same rule in SQL,
accepting that the rule now has two representations, or (b) invest in a real translation only when
ad hoc rule combinations genuinely explode and duplicating each one as a named repository method
has become the bigger cost.

```go
// GOOD: composite specification mirrors how an expert states the rule
type Eligible struct{}
func (Eligible) IsSatisfiedBy(c *Customer) bool { return c.Tier() == Premium }
type NotDelinquent struct{}
func (NotDelinquent) IsSatisfiedBy(c *Customer) bool { return !c.IsDelinquent() }

spec := And(Eligible{}, NotDelinquent{}) // same spec: validation, query filter, construction
```

**Anti-pattern:** a `SpecificationFactory`, or a generic rule engine / DSL that combines
specifications dynamically from configuration. Past `And`/`Or`/`Not`, you are rebuilding a worse,
unmaintained programming language inside the domain — with none of a real language's tooling, type
checking, or debugger. If the combination logic needs to be that dynamic, the "rule" is actually
data the business wants to edit, and belongs in a narrow rules table — not in code.

## 7. Domain service

**Principle.** A domain service exists only when a piece of domain behavior genuinely belongs to no
entity and no value object — typically an operation over several aggregates or a policy that is not
a thing's own responsibility. It is stateless, and it is named in the ubiquitous language after the
activity it performs.

**Why.** Domain services are the easiest place to accidentally rebuild a transaction script. Once a
service can hold behavior, every rule that was awkward to place lands there and the entities decay
into data holders — the anemic model. Default: place the behavior on an entity or value object
first, and fall back to a service only when placing it there would be a lie.
**A service whose name ends in `-Manager`, `-Processor`, `-Helper`, `-Util`, or `-Handler` is almost
always a modeling failure**, not a naming problem — the suffix means the author could not say what
it does in domain terms. Renaming does not fix it; find where the behavior belongs.

```go
// BAD: a bag of behavior that should live on the aggregates
type OrderManager struct{ ... }
func (m *OrderManager) ProcessOrder(o *Order) error

// GOOD: behavior on the entity that owns the rule
func (o *Order) Confirm(now time.Time) (*Order, error)

// GOOD: a real domain service — the rule belongs to neither party alone
type TransferPolicy struct{}
func (p TransferPolicy) Transfer(from, to *Account, amount Money) (*Account, *Account, error)
```

- Domain service ≠ application service. The application service orchestrates (transaction, auth,
  repository calls) and holds no rules; the domain service holds a rule and knows nothing about
  transactions or transport.

## 8. Sum type over nullable / discriminator

**Principle.** When the shape of the data depends on a kind, model the kind as a closed sum type
(algebraic data type), not as the presence/absence of a nullable field or a `string` union. Keep
the persistence representation (single-table inheritance: a discriminator column plus nullable
columns) in a separate layer from the domain representation.

**Why.** A `string` kind or a "this field is null so it must be variant X" check is not
exhaustive: a new variant compiles fine and silently falls through. A closed sum type forces every
site to handle every case and states the domain intent out loud. Deciding a record's kind from a
NULL — for example "version is null, so this row needs backfilling" — breaks the moment an
idempotency key or a legitimate null appears.

```go
// BAD: decide the kind from a nullable field
if entity.Version == nil {
    // treat as needing backfill
}

// BAD: kind as an open string union
type Kind string // "self" | "absolute" | "relative" — nothing stops a fourth value

// GOOD: a closed sum type (sealed interface + concrete variants)
type Source interface{ isSource() }
type SelfSource struct{}
type AbsoluteSource struct{ Value Money }
type RelativeSource struct{ Offset int32 }
```

- When external logic starts keying off a raw value ("if the language is Japanese use field A"),
  that is the signal to introduce an enum / sum type instead.
- Do not conflate the domain sum type with the DB's discriminator+nullable columns; map between
  them at the persistence boundary.

Related: represent "no value" with a type, not a sentinel. A pointer nil, a `0`, or an empty
string used to mean "absent" forces every caller to remember the special case. Use a
`Nullable*` value object, an explicit `Empty*` / `Null*` value, or a Null Object. Requests may be
optional; responses may be nullable; never treat `0` as null. Anything named `Default*` should be
a valid value — if it is not, name it `Empty*` / `Null*` instead.

## 9. Domain events / transactional outbox

**Principle.** A domain event records something that already happened, named in the past tense and
in the ubiquitous language. It is the mechanism for cross-aggregate and cross-context consistency
(section 2). One command = one transaction = one aggregate update = one kind of event. An event
payload carries the aggregate identifier only (the Claim Check pattern) — never PII or the raw
record. The outbox is at-least-once, so every subscriber must be idempotent. A publisher decides
whether to publish based on its own state, never on whether a subscriber happens to exist.

**Why.** Emitting several kinds of event from one transaction usually means the aggregate boundary
is drawn wrong. Putting raw payloads or PII in an event leaks them into logs and downstream stores
you do not control; passing only the id keeps the blast radius small. Because an outbox can
succeed at publishing but fail at deleting, the same message will be redelivered — a subscriber
that treats "already processed" as an error will spuriously fail on normal duplicates.

```go
// BAD: one transaction emits several kinds of event — boundary smell
tx.Publish(AddedEvent{})
tx.Publish(EnrichmentConfiguredEvent{})

// BAD: PII / raw payload on the event (ends up in logs)
Publish(Event{TenantID: tid, RawRecord: record})

// GOOD: id only; tenant identifier travels via context, not the payload
Publish(Event{AggregateID: id})

// GOOD: subscriber is idempotent — a duplicate is normal, not an error
if errors.Is(err, ErrAlreadyProcessed) {
    return nil
}
```

- Avoid a catch-all `AddedEvent` that hides which command produced which event; prefer a specific
  event, or split the aggregate when the kinds multiply.
- An event named for a technical operation (`RowUpdated`) rather than a business fact
  (`ShipmentDispatched`) is a language failure — see S1.
- Low-cardinality structured metadata on an event is fine; raw messages and stack traces are not.

## 10. Update consistency (TOCTOU / optimistic locking)

**Principle.** When you update, re-read the target under a lock inside the same transaction and
re-check the precondition before writing. Prevent concurrent double-execution with optimistic
locking (a unique constraint plus abort/retry), not with an in-memory guard.

**Why.** Between the read that loaded the entity and the write that commits it, another process can
change the state — the classic time-of-check-to-time-of-use race, which shows up as a duplicated
job or a lost update. Re-reading under lock (or relying on the store's abort-based optimistic
concurrency) closes the window.

```go
// BAD: read, then act on possibly-stale state, then blind-write
row := query()
result := external.Call()
update(row, result) // another writer may have moved on already

// GOOD: do external work outside the transaction; re-check inside it
result := external.Call()
tx.Do(func() {
    row := getByIDForUpdate(id) // re-read under lock
    if !row.PreconditionStillHolds() { return }
    row.Apply(result)
})
```

- Keep transactions short and never hold one open across an external API call — that is how lock
  contention and timeouts appear. Separate read-only from read-write transactions.

## 11. Multi-tenant isolation

**Principle.** Every table inside a tenant boundary carries a tenant identifier, and every query
condition includes it — on SELECT, UPDATE, DELETE, and every JOIN (defense in depth). Take the
tenant identifier from the authenticated context, not from a field on the root entity. Any escape
hatch that skips the tenant filter must carry a reason comment and a test.

**Why.** Tenant isolation is a security boundary: a single JOIN missing the tenant predicate can
return another tenant's rows. Storing the tenant identifier on the entity invites mismatch — the
wrong tenant gets written because someone set the field by hand; reading it from the auth context
keeps a single source of truth. A missing tenant column on a child table has caused real
data-deletion-on-offboarding incidents.

```go
// BAD: the root entity holds the tenant identifier (mismatch waiting to happen)
type Root struct { tenantID TenantID }

// GOOD: read it from the authenticated context; keep isolation in the infra layer
tid, err := auth.TenantID(ctx)

// BAD: a JOIN without the tenant predicate — cross-tenant leak
// ... FROM a JOIN b ON a.id = b.a_id
// GOOD
// ... FROM a JOIN b ON a.id = b.a_id AND a.tenant_id = b.tenant_id
```

- A skip option (a global/scheduled job that intentionally crosses tenants) needs a reason comment
  at the top of the repository method and a test; do not let it spread.
- Watch the width of the tenant-identifier column — a too-short type silently truncates and maps
  one tenant onto another.

## 12. Error taxonomy

**Principle.** Do not collapse errors into one coarse type. Give errors as many distinct kinds as
callers actually need to branch on. Translate a domain error into a transport status (HTTP / gRPC)
at the application/handler boundary — the domain layer must not know the transport protocol. Never
silently skip: surface a skip through a log or an error (a dead-letter queue for messaging).

**Why.** If two failures that need different runtime handling share one `ErrPermissionDenied`, the
caller cannot tell them apart and picks the wrong recovery. If the domain layer returns
transport-shaped errors, it now depends on the delivery mechanism and cannot be reused behind a
different protocol. A silent skip is invisible until data is already missing.

```go
// BAD: domain / repository layer returns a transport-shaped error
// (repository.go)
return nil, wrapAsNotFound(err) // repository now knows about HTTP status

// GOOD: domain returns a plain typed error; the boundary maps it to transport
// (repository.go)
return nil, wrap(ErrNotFound)
// (application service / handler)
if errors.Is(err, ErrNotFound) {
    return nil, wrapAsNotFound(err)
}
```

- A subscriber that swallows an error returns "success" and the message is never retried — it goes
  straight to the dead-letter queue. Wrap so the failure is retryable.
- If the frontend must distinguish causes, return an explicit reason enum rather than a single
  opaque error.

## 13. Time and interval design

**Principle.** Model periods and deadlines as half-open intervals: lower bound inclusive, upper
bound exclusive, compared with `<`. Persist timestamps in UTC. Do not put an `updated_at` on an
immutable (append-only) table.

**Why.** A `<=` on the upper bound double-counts the boundary instant — "due before midnight
tomorrow" quietly includes the next day's 00:00 — which has produced real under/over-counting
bugs. A single half-open convention across the codebase removes the whole class. An `updated_at`
on a table that is never updated is dead metadata that misleads readers (and refresh jobs that
touch it break watermark logic).

```go
// BAD: <= on the upper bound double-counts the boundary
if t <= endOfPeriod { /* ... */ }

// GOOD: half-open — lower inclusive, upper exclusive
if start <= t && t < end { /* ... */ }
```

- Prefer a dedicated range value object so the half-open convention is enforced in one place
  rather than re-derived at each comparison.

---

## What not to over-index on

Domain modeling review generates a lot of low-value noise. Do not treat these as findings:

- Pointer-vs-value micro-differences, formatter/linter minutiae, complexity-threshold arguments,
  helper-naming debates, early-return-vs-if-else style policing.
- Mechanical DRY: three similar lines are cheaper than a premature abstraction. Sometimes the
  right call is to leave the duplication.
- Tactical purity inside a supporting or generic subdomain (S4). A plain CRUD service there is the
  right answer; demanding aggregates and value objects is a cost with no return.
- Automated reviewer output flagged as high-severity: verify before acting. The same model that
  writes the code often mis-reads a call-site restriction or an intentional pattern as a
  vulnerability. If you are not confident, do not raise it.

## Related

For layer boundaries, the dependency rule, and where an interface is architecturally justified,
see the `clean-architecture` skill (clean-arch pack).
