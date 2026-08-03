---
name: event-driven-patterns
description: Use when designing or reviewing asynchronous message-driven systems — publishing or consuming events, choosing topic/queue topology, adding a transactional outbox, deciding between saga choreography and orchestration, introducing CQRS or a read model, evolving an event schema, or debugging duplicate processing, out-of-order delivery, lost events, oversized payloads, or a filling dead-letter queue.
---

# Event-Driven Patterns

Judgment criteria for asynchronous, message-driven design. Broker-agnostic:
applies to Kafka, Pub/Sub, SQS/SNS, RabbitMQ, NATS, EventBridge.

## Delivery semantics: what is actually true

**At-least-once is the only honest default.** Every other guarantee is
at-least-once plus deduplication somewhere — your job in a review is to find
*where*, and confirm someone owns it.

- A broker advertising "exactly-once" means dedup inside a bounded window
  (redelivery after it still duplicates), or exactly-once only within one
  broker-to-broker transaction — the moment your consumer writes to a database
  or calls an API, the guarantee stops applying. None of it makes a side
  effect outside the broker happen once.
- At-most-once (ack before processing) is valid only when losing a message is
  cheaper than handling it twice — metrics samples, cache invalidation hints.
  Never for anything a user or an auditor can observe.
- **Ack after the side effect is durable, never before.** Acking on receipt
  converts every crash into silent data loss. If processing can exceed the ack
  deadline, extend the lease rather than acking early to avoid redelivery.

**Consumer idempotency is non-negotiable**, not a hardening task for later. A
consumer whose correctness depends on being called once is already broken; it
just has not been redelivered yet.

## Idempotency key design

The key defines what "the same operation" means; choosing it badly makes dedup
useless or actively wrong.

| Key choice | When it is right | Failure mode |
|---|---|---|
| Broker message ID | Redelivery of the *same* message only | Republish after a producer retry has a new ID → duplicate slips through |
| Producer-assigned event ID (UUID at creation) | Default choice; survives producer retries | Requires the producer to generate once and reuse on retry, not per-attempt |
| Business key (`orderID` + transition) | Naturally idempotent domain operations | Two legitimately distinct events collapse into one if the transition can repeat |
| Payload hash | Last resort, no stable ID available | Any harmless field change (timestamp, trace ID) defeats it |

- **The dedup record and the side effect must commit in one transaction.**
  Effect first leaves a crash window that reprocesses; marker first loses the
  work entirely.
- Dedup retention is tied to the maximum realistic redelivery age (DLQ replay
  weeks later, not seconds). Unbounded is a slow-growing outage; too short
  silently stops deduping.
- "Already processed" is a **success**, not an error — a consumer that fails
  on duplicates will nack, redeliver, and dead-letter healthy traffic.

```go
// The dedup record and the effect commit together — this is the whole pattern.
func (h *Handler) Handle(ctx context.Context, ev Event) error {
    return h.db.InTx(ctx, func(tx Tx) error {
        // Unique constraint on (consumer_name, event_id).
        if err := tx.InsertProcessed(ctx, h.name, ev.ID); err != nil {
            if errors.Is(err, ErrDuplicateKey) {
                return nil // already applied — success, ack the message
            }
            return err
        }
        return h.apply(ctx, tx, ev)
    })
}
```

## Transactional outbox

**Required when losing an event corrupts state that a human or another service
will act on** — payment captured but never settled, order placed but never
fulfilled, entitlement granted but never revoked.

Without an outbox, a state change and its publish are two non-atomic
operations, and both orderings lose: publish before commit yields a phantom
event describing a fact that never happened (consumers act on a rollback);
commit before publish loses the event permanently on a crash in between, and
nothing in the system knows — the silent case, and the dangerous one.

**When publish-after-commit is acceptable:** the event is an optimization, not
a fact of record — cache warming, index refresh, anything a periodic
reconciliation job would recreate. The test: *if this event is lost and nobody
notices for a week, does the system self-heal?* If yes, skip the outbox. If
no, build it — and do not accept "we retry the publish in a defer block" as a
substitute, since that does not survive process death.

**Relay: polling vs CDC.** Default to a polling relay with an index on
`(published_at IS NULL, id)` — it is a plain worker, portable, and its failure
mode is legible. CDC (log tailing) buys near-real-time latency and native log
ordering at the price of connector infrastructure, coupling to the storage
log format, and connector lag/reset as a distinct on-call skill. Move to CDC
only for a measured latency requirement the poll interval cannot meet, or when
per-service relays have become the larger cost. Either way the relay is
at-least-once — it can publish and die before marking the row sent — which is
why consumer idempotency comes first, not second.

## Topology and fan-out

**Topic-per-event-type vs envelope topic** is a coupling decision, not a
performance one:

- Topic-per-event-type: subscribers filter by subscribing. New types need new
  infrastructure (topic, subscription, IAM) — friction that keeps the taxonomy
  honest — and a poison message in one type cannot stall another. Default for
  cross-team boundaries.
- Envelope topic (one stream, `type` discriminator): cheap to add types and
  preserves ordering across types, but every consumer receives every event and
  discards most, and one bad message blocks the partition for everyone.
  Reasonable *within* one bounded context, where the taxonomy and the
  consumers change together.

**Fan-out at the publisher (publish N times) is almost always wrong** — the
publisher then knows its subscribers, the exact coupling events exist to
remove, and a partial failure mid-loop leaves subscribers inconsistent.
Publish once; let subscriptions fan out. If a destination genuinely needs a
*different* message (different schema or redaction level), that is a signal
you have two events, not one publisher-side loop.

**Ordering keys are a throughput ceiling.** An ordering key serializes
delivery for that key to one consumer at a time: no concurrency within the
key, and head-of-line blocking — one slow or failing message stalls every
later message for that key.

- You almost always need **per-entity ordering** (all events for `order-123`
  in order), so the key is the entity ID and unrelated entities stay parallel.
  Global ordering across a topic is a single-threaded system; demand a
  concrete reason before accepting it.
- Ask first whether you need ordering at all: if handlers are commutative, or
  events carry a version the consumer uses to discard stale updates, it is a
  cost you can skip. Making the *consumer* tolerate reordering is usually
  cheaper than buying ordering from the broker.
- Dead-lettering breaks the very guarantee the key provides. Decide explicitly
  whether the stream stalls or the gap is accepted.

## Event carry: fat vs thin

| | Thin (id + version) | Fat (full state) |
|---|---|---|
| Coupling | Consumers call back to the producer | Consumers depend on the producer's schema |
| Freshness | Always current — sometimes *too* current: the consumer reads state from after a later change and processes the event against state that never coexisted with it | Consistent snapshot at emit time |
| Cost | Producer down stalls consumers; fan-out becomes a thundering herd of callbacks | Larger payloads, PII and schema exposure |

Default to **thin**, and let consumers fetch — the schema coupling of fat
events is what makes them impossible to change later. Choose fat when the
consumer must survive producer downtime, when the read-back herd is real load,
or when the consumer needs point-in-time state (audit, analytics). Never put
PII or raw records in a fat event: events land in logs, replays, and
downstream stores you do not control.

## Claim check

When payloads approach the broker's limit, write the body to object storage
and put a reference in the message.

- Trigger well below the hard limit — brokers count encoded size with headers,
  so a payload that passes locally fails in production after one added
  attribute.
- Lifecycle is the trap: blob retention must exceed the maximum retry and
  DLQ-replay window, or a replayed message points at a deleted object.
- Keep enough inline (IDs, type, version) to triage without fetching — a
  reference-only message records where the data was, not what happened.

## Schema evolution

**Additive-only within a version.** Adding an optional field with a default is
safe; removing a field, renaming it, narrowing a type, or changing semantics
while keeping the name is not — the last is the worst, because nothing fails
loudly and consumers quietly compute wrong answers.

- Consumers must **ignore unknown fields** rather than reject them; a strict
  parser makes every producer addition a coordinated deployment.
- A breaking change means a new version — new topic (`orders.v2`) or a version
  field — published in parallel until consumers migrate. You cannot atomically
  upgrade producer and consumers of an async contract, so any plan that
  requires it is not a plan.
- Replay means old-schema messages hit new code: consumers must handle every
  version still inside the retention window. That is the real cost of a
  version bump, and the reason to keep changes additive.

## Poison messages and DLQ policy

A DLQ defers a decision; it does not discard one.

- **Budget the retry, don't count it.** What matters is total retry *time*
  before dead-lettering, chosen against how long a typical transient
  dependency outage lasts. Too aggressive and a 90-second downstream blip
  dead-letters real traffic; too generous and one poison message consumes
  subscriber throughput for days.
- **Separate retryable from terminal at the handler.** A validation failure or
  unknown event type fails identically on every attempt — dead-letter it
  immediately instead of burning the budget.
- **The dead letter must carry enough to act on without the original context:**
  the unmodified payload, the failure reason and stack from the final attempt,
  attempt count and first/last failure timestamps, source topic/subscription,
  and trace ID. A dead letter with only the payload forces a log archaeology
  dig, so nobody does it.
- Replay needs idempotency (you have it) and a way to skip genuinely
  unprocessable messages. An unmonitored DLQ is delayed data loss — pair it
  with an alert on non-zero depth and a named owner.

## Saga vs distributed transaction

Two-phase commit across services is off the table in practice: it needs
synchronous participation and a coordinator whose failure holds locks across
services. Use a saga — local transactions, each with a compensating action.

| | Choreography | Orchestration |
|---|---|---|
| Control flow | Emergent, in the events | Explicit, in one coordinator |
| Fits | 2–3 steps, stable flow, autonomous teams | 4+ steps, branching, timeouts, approvals |
| Cost | Nobody can answer "what is the state of this order?" without reconstructing it from logs across services; adding a step edits several services | The coordinator is a dependency and can grow into a god service |

Default to choreography for short flows; switch to orchestration the moment
someone needs to *query* saga state, or a step needs a timeout or retry policy
of its own. The orchestrator owns only the flow — business rules stay in the
services.

**Compensation is semantic, not a rollback.** A compensating action is a new
forward transaction offsetting the effect (refund, cancellation, credit note);
the original still happened and stays in the audit trail. Design each
compensator with the original step, not later.

Some things cannot be compensated: a notification sent, a payment captured at
a partner with no refund API, a third party informed, a physical action
started. Order the saga so irreversible steps come **last**, after everything
reversible has succeeded — or gate them behind a pending state a later step
confirms. If an irreversible step must run early, the saga needs a human
escalation path; pretending otherwise is the design flaw.

## CQRS and read models

**The read-model complexity pays only after read and write shapes have
actually diverged** — different access patterns, wildly different read/write
ratios, or aggregation across aggregates that the write model cannot serve
without expensive joins. Before that, a denormalized query or a materialized
view on the same store gets most of the benefit at a fraction of the cost.
Introducing it early buys a second store to provision and back up, a projector
to operate, an out-of-sync failure mode, and a rebuild procedure someone must
write and test — and read-your-own-writes stops being free, which is the part
that surfaces as user-visible bugs.

**Eventual-consistency UX is the design work, not a caveat.** Decide per flow:
serve the actor who just wrote from the write model while others read the
projection; echo submitted values optimistically; or show explicit pending
state. The failure to avoid is a UI silently showing stale data right after a
user's own action — users read that as data loss and retry, creating exactly
the duplicates you now have to dedup.

Projections must be idempotent and rebuildable from the event stream. One that
can only be built forward from live traffic cannot be fixed after a bug, which
makes every projector bug permanent corruption.

## Related

- `ddd-modeling-review` (packs/ddd) — domain events, event naming, and the
  outbox from the modeling side: what an event *is* before it is a message.
- `gcp-patterns` (packs/gcp) — Pub/Sub-specific ack deadlines, ordering keys,
  and DLQ configuration.
