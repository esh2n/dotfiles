---
name: ddd-modeling-review
description: Review and design guide for aggregate-based Domain-Driven Design. Use when reviewing or implementing a DDD codebase, when deciding layer responsibilities, aggregate boundaries, value objects, entities, sum types, domain events, or tenant isolation, and when a schema/migration or error taxonomy has domain implications. Distilled from a large body of real backend review comments and generalized to be project-independent.
metadata:
  origin: extracted
---

# DDD Modeling Review

Review points for aggregate-based Domain-Driven Design. Each category states a principle
(language-independent), why it matters, and concrete BAD/GOOD examples. Go is used as the
primary example language because DDD structure surfaces most clearly there, but the principles
apply to any language.

Two habits underlie every point below:

- **Look at several existing patterns before deciding.** Do not conclude from a single example.
  Sweep every aggregate/table/handler of the same shape, learn the common form and the deviations,
  then form an opinion.
- **No cargo-culting.** "The existing code does it this way" is not a reason. Ask why it is that
  way from first principles and back it with an authoritative source (an architecture decision
  record, the datastore's official docs). Do not state a guess as a fact.

---

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
- Do not create an object literally named `service` inside the domain layer, and do not let
  application services depend on one another.

## 2. Aggregate boundary

**Principle.** An aggregate has a single root entity (not a collection). Never reach outside your
own aggregate directly: read another aggregate through its query interface, or react to its
event. A cross-aggregate direct update is forbidden. Cross-boundary collaboration is asynchronous
messaging. An aggregate holds no more knowledge or state than it needs.

**Why.** Direct access across aggregates couples their lifecycles and destroys independent
evolvability — a schema change in one silently breaks the other. Asynchronous messaging across a
bounded context keeps the services loosely coupled and independently deployable.

```go
// BAD: aggregate A queries aggregate B's table/package directly
rows := s.db.Query(ctx, "SELECT ... FROM other_aggregate_table WHERE ...")

// GOOD: go through the other aggregate's query interface (synchronous)
filters, err := s.otherAggregateQuery.ListByTenant(ctx)

// GOOD (cross-boundary): react to an event instead of reading across the boundary
```

- No cross-aggregate `Update`. Crossing a bounded context goes through the message bus.
- Keep the aggregate self-contained; do not give it a field (for example a `selection_kind`) that
  exists only to serve another aggregate's concern.
- A use case that must read across several aggregates belongs in a dedicated read model / view,
  not inside any one aggregate.
- Do not mint a new aggregate for infrastructure convenience. Ask: "if nothing about this is
  persisted on its own, is it really an aggregate?"

## 3. Repository vs. query service

**Principle.** A repository persists and restores aggregate roots only (`*Root` / `[]*Root`) plus
the infrastructure mapping. Partial views and purpose-built read models go to a separate query
service. When nothing is found, return a typed NotFound error, never `(nil, nil)`.

**Why.** If a repository is allowed to return header-only rows or a bespoke list model, the
aggregate stops being the unit of consistency and every caller invents its own shape. `(nil, nil)`
forces every caller to remember to nil-check and turns a missing row into a nil-pointer panic far
from the cause.

```go
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
Wrap a shared value object per aggregate rather than reusing it raw, so it cannot be mixed up.
Never serialize a value object directly to JSON / DB / wire — go through an intermediate mapping.
Expose only the getters you actually need.

**Why.** A self-validating value object makes an invalid instance unrepresentable, so downstream
code never re-checks. Passing it by value (not pointer) removes the "someone passed nil" class of
bug entirely. Wrapping a shared type per aggregate stops a value meant for one aggregate from
being silently accepted by another. A getter that leaks the underlying primitive (`Int64()`)
invites callers to bypass the type; assistants love to add these — delete them.

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

## 5. Entity: factory, restore, invariants

**Principle.** A factory guarantees invariants. A `New*` constructor validates external input and
returns an error — it never panics; only a `Must*` variant may panic (for tests and self-evident
literals). A `restore` from the datastore always returns a valid entity, because the value was
already valid when stored. Generate the identifier and creation time inside the factory, not from
arguments. Keep fields unexported. Prefer immutable roots for anything persisted.

**Why.** If `New*` can panic, every caller must guard against a crash on ordinary bad input; an
error return makes the failure a normal, testable path. Constructor arguments typed as value
objects (not bare primitives, `bool` excepted) prevent the classic "two arguments swapped" defect.
Restoring only valid entities means the rest of the code never handles a half-built object.

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

## 6. Sum type over nullable / discriminator

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

## 7. Domain events / transactional outbox

**Principle.** One command = one transaction = one aggregate update = one kind of event. An event
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
- Low-cardinality structured metadata on an event is fine; raw messages and stack traces are not.

## 8. Update consistency (TOCTOU / optimistic locking)

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

## 9. Multi-tenant isolation

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

## 10. Error taxonomy

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

## 11. Time and interval design

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
- Automated reviewer output flagged as high-severity: verify before acting. The same model that
  writes the code often mis-reads a call-site restriction or an intentional pattern as a
  vulnerability. If you are not confident, do not raise it.
