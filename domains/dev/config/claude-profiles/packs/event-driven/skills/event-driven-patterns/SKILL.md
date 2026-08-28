---
name: event-driven-patterns
description: Use when designing or reviewing asynchronous message-driven systems — publishing or consuming events, choosing topic/queue topology, adding a transactional outbox, deciding between saga choreography and orchestration, introducing CQRS or a read model, evolving an event schema, or debugging duplicate processing, out-of-order delivery, lost events, oversized payloads, or a filling dead-letter queue.
---

# Event-Driven Patterns

Judgment criteria for asynchronous, message-driven design. Broker-agnostic:
applies to Kafka, Pub/Sub, SQS/SNS, RabbitMQ, NATS, EventBridge.

## Delivery semantics: what is actually true

**[silence]** **At-least-once is the only honest default.** Every other
guarantee is at-least-once plus deduplication somewhere — your job in a review
is to find *where*, and confirm someone owns it.

- A broker advertising "exactly-once" dedups inside a bound that is
  broker-specific and not always temporal, so name the bound before relying on
  it: SQS FIFO deduplicates within a 5-minute interval
  (https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-exactly-once-processing.html),
  Pub/Sub within a region and per message ID
  (https://docs.cloud.google.com/pubsub/docs/exactly-once-delivery), Kafka
  only within one transaction. Redelivery outside the bound still duplicates,
  and the moment your consumer writes to a database or calls an API the
  guarantee stops applying: none of it makes a side effect happen once across
  independently deployed services over RPC. The narrow exception is Kafka
  KIP-939, whose external-coordinator 2PC covers a Kafka-plus-database dual
  write inside one service
  (https://cwiki.apache.org/confluence/display/KAFKA/KIP-939:+Support+Participation+in+2PC).
- At-most-once (ack before processing) is valid only when losing a message is
  cheaper than handling it twice — metrics samples, cache invalidation hints.
  Never for anything a user or an auditor can observe.
- **[defect]** **Ack after the side effect is durable, never before.** Acking
  on receipt converts every crash into silent data loss. If processing can
  exceed the ack deadline, extend the lease rather than acking early to avoid
  redelivery.

**[defect]** **Consumer idempotency is non-negotiable**, not a hardening task
for later. A consumer whose correctness depends on being called once is
already broken; it just has not been redelivered yet.

**[defect]** **A consumer group rebalance is a duplicate and stall source, not
a background detail.** When a member joins, leaves, or overruns
`max.poll.interval.ms`, its partitions are revoked and reassigned, and every
message processed since the last committed offset is redelivered to the new
owner; a handler slower than the poll interval evicts itself and rebalances
forever. Size `max.poll.interval.ms` against the slowest handler, give members
a stable `group.instance.id` (static membership) so a rolling restart does not
trigger a reassignment, and prefer the cooperative-sticky assignor so a
rebalance pauses only the partitions that move rather than all of them
(https://kafka.apache.org/documentation/#consumerconfigs).

## Idempotency key design

The key defines what "the same operation" means; choosing it badly makes dedup
useless or actively wrong.

| Key choice | When it is right | Failure mode |
|---|---|---|
| Broker message ID | Redelivery of the *same* message only | Republish after a producer retry has a new ID → duplicate slips through |
| Producer-assigned event ID (UUID at creation) | Default choice; survives producer retries | Requires the producer to generate once and reuse on retry, not per-attempt |
| Business key (`orderID` + transition) | Naturally idempotent domain operations | Two legitimately distinct events collapse into one if the transition can repeat |
| Payload hash | Last resort, no stable ID available | Any harmless field change (timestamp, trace ID) defeats it |

- **[defect]** **The dedup record and the side effect must commit in one
  transaction.** Effect first leaves a crash window that reprocesses; marker
  first loses the work entirely. When the side effect is an external API call
  there is no such transaction, so pick the non-transactional branch instead:
  send an idempotency key the provider honours, or split the call into
  claim → confirm (record the intent, call, record the outcome) so a crash
  leaves a claim that a retry or a reconciliation job can resolve.
- **[silence]** Dedup retention must be at least
  `max(topic retention, DLQ replay SLA)` — 7–30 days by default, because
  replays arrive weeks later, not seconds. Unbounded is a slow-growing outage,
  so pair the retention with an alert on dedup table growth; too short
  silently stops deduping.
- **[defect]** "Already processed" is a **success**, not an error — a consumer
  that fails on duplicates will nack, redeliver, and dead-letter healthy
  traffic.

This is the inbox pattern — the consumer-side mirror of the outbox, where a
processed-message table is written in the same transaction as the effect:

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

**[silence]** **Required when losing an event corrupts state that a human or
another service will act on** — payment captured but never settled, order
placed but never fulfilled, entitlement granted but never revoked.

Without an outbox, a state change and its publish are two non-atomic
operations, and both orderings lose: publish before commit yields a phantom
event describing a fact that never happened (consumers act on a rollback);
commit before publish loses the event permanently on a crash in between, and
nothing in the system knows — the silent case, and the dangerous one.

**[trade-off]** **When publish-after-commit is acceptable:** the event is an
optimization, not a fact of record — cache warming, index refresh, anything a periodic
reconciliation job would recreate. The test: *if this event is lost and nobody
notices for a week, does the system self-heal?* If yes, skip the outbox. If
no, build it — and do not accept "we retry the publish in a defer block" as a
substitute, since that does not survive process death.

**[trade-off]** **Relay: polling vs CDC.** Default to a polling relay with a
partial index `(id) WHERE published_at IS NULL` — Postgres and SQLite support
that shape directly; on engines without partial indexes (MySQL) index a
`status` column instead. It is a plain worker, portable, and its failure mode
is legible. CDC (log tailing) buys near-real-time latency and native log
ordering at the price of connector infrastructure, coupling to the storage
log format, and connector lag/reset as a distinct on-call skill. Move to CDC
only for a measured latency requirement the poll interval cannot meet, or when
per-service relays have become the larger cost. Either way the relay is
at-least-once — it can publish and die before marking the row sent — which is
why consumer idempotency comes first, not second.

## Topology and fan-out

**[trade-off]** **Topic-per-event-type vs envelope topic** is a coupling
decision, not a performance one:

- Topic-per-event-type: subscribers filter by subscribing. New types need new
  infrastructure (topic, subscription, IAM) — friction that keeps the taxonomy
  honest — and a poison message in one type cannot stall another. Default for
  cross-team boundaries.
- Envelope topic (one stream, `type` discriminator): cheap to add types and
  preserves ordering across types only within a partition or ordering key, but
  every consumer receives every event and discards most, and one bad message
  blocks the partition for everyone.
  Reasonable *within* one bounded context, where the taxonomy and the
  consumers change together.

**[defect]** **Fan-out at the publisher (publish N times) is almost always
wrong** — the publisher then knows its subscribers, the exact coupling events
exist to remove, and a partial failure mid-loop leaves subscribers
inconsistent.
Publish once; let subscriptions fan out. If a destination genuinely needs a
*different* message (different schema or redaction level), that is a signal
you have two events, not one publisher-side loop.

**[trade-off]** **Ordering keys are a throughput ceiling.** Ordering serializes
delivery within its unit, and the unit differs by broker: on Kafka and Kinesis
it is the *partition* — many keys share one, and the guarantee is a "total
order over messages within a partition, not between different partitions"
(https://kafka.apache.org/documentation/#intro_concepts_and_terms) — while on
Pub/Sub it is the individual ordering key. No concurrency inside that unit,
and head-of-line blocking applies to the same unit: one slow or failing
message stalls every later message in its partition (Kafka/Kinesis) or for its
key (Pub/Sub). Ask which one applies before you estimate the blast radius.

- **[silence]** You almost always need **per-entity ordering** (all events for
  `order-123` in order), so the key is the entity ID and unrelated entities
  stay parallel. Global ordering across a topic is a single-threaded system:
  default to rejecting it, and accept it only against a reason written into
  the design (a single ledger whose total order *is* the product requirement).
- **[defect]** The key also decides load distribution, not just ordering.
  Hashing on a low-cardinality or skewed field — a tenant ID where one tenant
  is most of the traffic, a country code, a constant `"default"` — parks a hot
  partition on one consumer while the rest idle, and the topic's ceiling
  becomes that one partition's throughput. Check cardinality and skew against
  the partition count; when the natural key is skewed, either salt the hot
  tenant across sub-keys and give up ordering for it, or give it its own
  topic.
- Ask first whether you need ordering at all: if handlers are commutative, or
  events carry a version the consumer uses to discard stale updates, it is a
  cost you can skip. Making the *consumer* tolerate reordering is usually
  cheaper than buying ordering from the broker.
- **[silence]** Dead-lettering breaks the very guarantee the key provides.
  Decide explicitly whether the stream stalls or the gap is accepted, and
  write the choice down: default to accepting the gap (dead-letter, alert,
  keep moving), and stall only where the entity's later events are meaningless
  without the failed one — a ledger, a state machine.

## Event carry: fat vs thin

| | Thin (id + version) | Fat (full state) |
|---|---|---|
| Coupling | Consumers call back to the producer | Consumers depend on the producer's schema |
| Freshness | Always current — sometimes *too* current: the consumer reads state from after a later change and processes the event against state that never coexisted with it | Consistent snapshot at emit time |
| Cost | Producer down stalls consumers; fan-out becomes a thundering herd of callbacks | Larger payloads, PII and schema exposure |

**[trade-off]** Choose on consumer autonomy rather than by default: thin when
consumers are co-deployed with the producer and the producer is highly
available, so the callback is cheap and the schema moves with them; fat
(event-carried state transfer) when the consumer must survive producer
downtime, when the read-back herd is real load, or when the consumer needs
point-in-time state (audit, analytics).

**[silence]** PII or raw records in a fat event inherit the topic's retention,
and events land in logs, replays, and downstream stores you do not control —
require a named erasure plan (crypto-shredding, short retention, or a claim
check whose blob an erasure job can delete) before including them.

## Claim check

When payloads approach the broker's limit, write the body to object storage
and put a reference in the message.

- **[defect]** Trigger at roughly 50% of the encoded limit, counting headers
  and attributes — brokers measure encoded size with headers, so a payload
  that passes locally fails in production after one added attribute.
- Lifecycle is the trap: blob retention must exceed the maximum retry and
  DLQ-replay window, or a replayed message points at a deleted object.
- Keep enough inline (IDs, type, version) to triage without fetching — a
  reference-only message records where the data was, not what happened.

## Schema evolution

**[defect]** **Additive-only within a version.** Adding an optional field with
a default is safe only together with a deployment order: under Confluent
Schema Registry's default BACKWARD compatibility an additive change means
upgrade consumers first, and a field removal (FORWARD) means producers first
(https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html).
Renaming a field, narrowing a type, or changing semantics while keeping the
name is not safe in any order — the last is the worst, because nothing fails
loudly and consumers quietly compute wrong answers.

- **[defect]** Consumers must **ignore unknown fields** rather than reject
  them; a strict parser makes every producer addition a coordinated
  deployment.
- A breaking change means a new version — new topic (`orders.v2`) or a version
  field — published in parallel until consumers migrate. You cannot atomically
  upgrade producer and consumers of an async contract, so any plan that
  requires it is not a plan.
- Replay means old-schema messages hit new code: consumers must handle every
  version still inside the retention window. That is the real cost of a
  version bump, and the reason to keep changes additive.

## Poison messages and DLQ policy

A DLQ defers a decision; it does not discard one.

- **[trade-off]** **Budget the retry, don't count it.** What matters is total
  retry *time* before dead-lettering, chosen against how long a typical
  transient dependency outage lasts: minutes (5–15) for a synchronous
  dependency someone is waiting on, hours for batch and back-office flows. Too
  aggressive and a 90-second downstream blip dead-letters real traffic; too
  generous and one poison message consumes subscriber throughput for days.
- **[trade-off]** *Where* the wait happens is a separate decision from how
  long it lasts. Retrying in place holds the partition or the message lease
  for the whole backoff, so a slow dependency stalls everything queued behind
  it — the same head-of-line cost an ordering key buys. Moving the message to
  a delay queue or tiered retry topics (`orders.retry.30s`,
  `orders.retry.5m`) keeps the main partition flowing, at the price of losing
  per-key ordering across the retry and operating extra topics and consumers.
  Retry in place only for waits that fit inside the ack deadline.
- **[defect]** **Separate retryable from terminal at the handler.** A
  validation failure or unknown event type fails identically on every
  attempt — dead-letter it immediately instead of burning the budget.
- **[defect]** **The dead letter must carry enough to act on without the
  original context:** the unmodified payload, the failure reason and stack
  from the final attempt,
  attempt count and first/last failure timestamps, source topic/subscription,
  and trace ID. A dead letter with only the payload forces a log archaeology
  dig, so nobody does it.
- Replay needs idempotency (you have it) and a way to skip genuinely
  unprocessable messages. An unmonitored DLQ is delayed data loss — pair it
  with an alert on non-zero depth and a named owner.
- **[silence]** Alert on consumer lag too, not only DLQ depth: the DLQ stays
  empty while a consumer merely falls behind or stops consuming altogether.
  Track both offset lag and the age of the oldest unacked message — age is the
  one that maps to a user-visible promise and does not look healthy just
  because traffic dropped — and name its threshold and owner next to the DLQ
  alert.

## Saga vs distributed transaction

Two-phase commit across independently deployed services over RPC is off the
table in practice: it needs synchronous participation and a coordinator whose
failure holds locks across services. (The narrow exception stays inside one
service — Kafka's KIP-939 external-coordinator 2PC over a broker and its own
database.) Use a saga — local transactions, each with a compensating action.

| | Choreography | Orchestration |
|---|---|---|
| Control flow | Emergent, in the events | Explicit, in one coordinator |
| Fits | 2–3 steps, stable flow, autonomous teams | 4+ steps, branching, timeouts, approvals |
| Cost | Nobody can answer "what is the state of this order?" without reconstructing it from logs across services; adding a step edits several services | The coordinator is a dependency and can grow into a god service |

**[trade-off]** Let capability decide, not length: default to choreography for
short flows, and switch to orchestration the moment someone needs to *query*
saga state, or a step needs a timeout, retry policy, or approval of its own.
Step count is only a hint that those needs are coming (2–3 steps usually stay
choreographed, 4+ usually do not), never the trigger on its own. The
orchestrator owns only the flow — business rules stay in the services.

**[silence]** **Compensation is semantic, not a rollback.** A compensating
action is a new forward transaction offsetting the effect (refund,
cancellation, credit note);
the original still happened and stays in the audit trail. Design each
compensator with the original step, not later.

**[defect]** Some things cannot be compensated: a notification sent, a payment
captured at a partner with no refund API, a third party informed, a physical
action started. Order the saga so irreversible steps come **last**, after everything
reversible has succeeded — or gate them behind a pending state a later step
confirms. If an irreversible step must run early, the saga needs a human
escalation path; pretending otherwise is the design flaw.

## CQRS and read models

**[trade-off]** **The read-model complexity pays only after read and write
shapes have actually diverged** — different access patterns, wildly different
read/write ratios, or aggregation across aggregates that the write model cannot serve
without expensive joins. Before that, a denormalized query or a materialized
view on the same store gets most of the benefit at a fraction of the cost.
Introducing it early buys a second store to provision and back up, a projector
to operate, an out-of-sync failure mode, and a rebuild procedure someone must
write and test — and read-your-own-writes stops being free, which is the part
that surfaces as user-visible bugs.

**[silence]** **Eventual-consistency UX is the design work, not a caveat.**
Decide per flow: serve the actor who just wrote from the write model while others read the
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
