# event-driven-patterns — review checklist

Derived from ../SKILL.md. Consumed by the `review` (defects), `design-review` (silences + trade-offs) and `grilling` (trade-offs) workflows. Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

## defects
Objectively checkable in a diff or config. A match is a finding.

- id: event-driven:ack-before-durable
  rule: A consumer acks only after its side effect is durable.
  check: ack/commit-offset call that precedes the DB commit or external call in the handler; also flag early ack used to dodge the ack deadline instead of extending the lease.
  section: "## Delivery semantics: what is actually true"

- id: event-driven:consumer-not-idempotent
  rule: Every consumer tolerates redelivery of the same message.
  check: handler with a non-idempotent side effect (insert without unique constraint, balance increment, unkeyed external call) and no dedup record or idempotency key anywhere in the path.
  section: "## Delivery semantics: what is actually true"

- id: event-driven:rebalance-config
  rule: Consumer group config survives a rebalance without self-eviction or all-partition stalls.
  check: `max.poll.interval.ms` left at default while the handler can run longer; consumers with no `group.instance.id` (static membership) despite rolling restarts; assignor not cooperative-sticky.
  section: "## Delivery semantics: what is actually true"

- id: event-driven:dedup-and-effect-not-atomic
  rule: The dedup record and the side effect commit together — or, for an external call, use a provider idempotency key, claim → confirm, or reconciliation.
  check: processed-message insert and the effect in separate transactions or separate statements without a tx; external API call in a handler with no idempotency key header and no claim/confirm record.
  section: "## Idempotency key design"

- id: event-driven:duplicate-treated-as-error
  rule: "Already processed" returns success and acks; it never nacks.
  check: duplicate-key error path that returns an error, nacks, or raises instead of returning nil/ack.
  section: "## Idempotency key design"

- id: event-driven:publisher-side-fanout
  rule: Publish once and let subscriptions fan out.
  check: a loop or sequence publishing the same event to N topics/queues in the producer; partial-failure handling mid-loop.
  section: "## Topology and fan-out"

- id: event-driven:skewed-partition-key
  rule: The partition/ordering key has enough cardinality and low enough skew to spread load.
  check: key derived from a constant, a country code, a status, or a tenant ID where one tenant dominates; compare key cardinality against partition count.
  section: "## Topology and fan-out"

- id: event-driven:claim-check-threshold
  rule: Switch to a claim check at roughly 50% of the encoded broker limit, headers and attributes counted.
  check: size threshold constant set at or near the hard limit, or a size check that measures the body only and ignores headers/attributes.
  section: "## Claim check"

- id: event-driven:schema-change-and-deploy-order
  rule: Schema changes are additive within a version, with the deployment order the compatibility mode requires (BACKWARD ⇒ consumers first; FORWARD ⇒ producers first).
  check: schema diff that renames, removes, narrows a type, or changes the meaning of a kept field; additive change shipped with no stated consumer-before-producer rollout.
  section: "## Schema evolution"

- id: event-driven:consumer-rejects-unknown-fields
  rule: Consumers ignore unknown fields rather than rejecting them.
  check: strict/forbid-unknown parser settings on the event decode path (`DisallowUnknownFields`, `strict: true`, schema validators with `additionalProperties: false`).
  section: "## Schema evolution"

- id: event-driven:retryable-vs-terminal-not-separated
  rule: Terminal failures dead-letter immediately instead of consuming the retry budget.
  check: handler returning one undifferentiated error type; validation failures and unknown event types going through the same retry path as transient errors.
  section: "## Poison messages and DLQ policy"

- id: event-driven:dead-letter-missing-context
  rule: A dead letter carries the unmodified payload, final failure reason and stack, attempt count, first/last failure timestamps, source topic/subscription, and trace ID.
  check: DLQ publish path that forwards only the payload or only an error string.
  section: "## Poison messages and DLQ policy"

- id: event-driven:irreversible-step-ordered-early
  rule: Irreversible saga steps run last, are gated behind a pending state a later step confirms, or carry a human escalation path.
  check: saga/step definition where a notification, capture, or third-party call precedes steps that can still fail, with no pending-state gate.
  section: "## Saga vs distributed transaction"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: event-driven:delivery-semantics-unstated
  rule: The design states the delivery guarantee it relies on, the broker-specific bound of any "exactly-once" claim, and where dedup actually lives.
  check: For each new topic/queue/consumer, look for an explicit at-least-once/exactly-once claim, the named dedup bound (SQS FIFO 5-minute interval, Pub/Sub region + message ID, Kafka transaction), and the dedup mechanism plus its owner; flag when any is missing.
  section: "## Delivery semantics: what is actually true"

- id: event-driven:dedup-retention-unstated
  rule: Dedup retention is at least max(topic retention, DLQ replay SLA) — 7–30 days by default — with an alert on dedup table growth.
  check: Look for a stated retention/TTL on the processed-message store and a growth alert; flag an unstated, unbounded, or sub-retention window.
  section: "## Idempotency key design"

- id: event-driven:outbox-need-unstated
  rule: The design says whether losing this event corrupts state a human or another service acts on, and therefore whether an outbox is required.
  check: For each publish tied to a state change, look for the self-heal test answered explicitly; flag a fact-of-record event (payment, order, entitlement) published with no outbox and no reasoning.
  section: "## Transactional outbox"

- id: event-driven:global-ordering-unjustified
  rule: Ordering is per-entity by default; global ordering across a topic is accepted only against a written reason.
  check: Look for the ordering key named per entity ID; where the design orders a whole topic, look for the recorded reason (a ledger whose total order is the requirement) and flag its absence.
  section: "## Topology and fan-out"

- id: event-driven:dlq-ordering-gap-undecided
  rule: The design states whether dead-lettering an ordered message stalls the stream or leaves an accepted gap (default: accept the gap plus an alert).
  check: For every topic with an ordering key and a DLQ, look for the stated choice; flag when neither stall nor gap is named.
  section: "## Topology and fan-out"

- id: event-driven:pii-erasure-plan-unstated
  rule: PII or raw records in an event come with a named erasure plan, because they inherit the topic's retention.
  check: Identify event schemas carrying personal data; look for crypto-shredding, a short retention, or a deletable claim-check blob; flag when none is named.
  section: "## Event carry: fat vs thin"

- id: event-driven:consumer-lag-sli-unstated
  rule: Consumer lag is alerted on — both offset lag and age of the oldest unacked message — with a threshold and an owner, not only DLQ depth.
  check: Look for a lag/age SLI alongside the DLQ depth alert; flag a design whose only consumer alarm is DLQ depth.
  section: "## Poison messages and DLQ policy"

- id: event-driven:compensator-unstated
  rule: Each saga step names its compensating forward transaction, designed with the step rather than later.
  check: Walk the saga steps in the design; flag any step with a side effect and no named compensator (or no statement that it is irreversible).
  section: "## Saga vs distributed transaction"

- id: event-driven:eventual-consistency-ux-unstated
  rule: Each read flow over a projection states how the actor who just wrote sees their own write.
  check: For every UI/API flow reading a read model, look for read-from-write-model, optimistic echo, or explicit pending state; flag a flow that silently serves a possibly stale projection right after the user's own action.
  section: "## CQRS and read models"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: event-driven:outbox-or-publish-after-commit
  rule: Transactional outbox vs plain publish-after-commit.
  options: outbox (no lost events, a relay to build and operate) | publish-after-commit (nothing extra to run, silent loss on a crash unless reconciliation recreates the event)
  section: "## Transactional outbox"

- id: event-driven:relay-polling-or-cdc
  rule: Outbox relay as a polling worker vs CDC log tailing.
  options: polling (portable, legible failure mode, poll-interval latency) | CDC (near-real-time, native log ordering, connector infrastructure and lag/reset as a new on-call skill)
  section: "## Transactional outbox"

- id: event-driven:topic-per-type-or-envelope
  rule: Topic-per-event-type vs one envelope topic with a `type` discriminator.
  options: topic-per-type (poison isolation, friction keeps the taxonomy honest, new infra per type) | envelope (cheap new types, ordering across types within a partition, every consumer reads everything and one bad message blocks all)
  section: "## Topology and fan-out"

- id: event-driven:ordering-key-or-tolerant-consumer
  rule: Buy ordering from the broker vs make the consumer tolerate reordering.
  options: ordering key (in-order delivery, throughput ceiling and head-of-line blocking per partition on Kafka/Kinesis or per key on Pub/Sub) | tolerant consumer (full parallelism, commutative handlers or version-based staleness checks to write and test)
  section: "## Topology and fan-out"

- id: event-driven:thin-or-fat-event
  rule: Thin event (id + version) vs fat event carrying state.
  options: thin (small payload, no schema exposure, consumers stall when the producer is down and fan-out becomes a callback herd) | fat / event-carried state transfer (consumer autonomy and point-in-time state, larger payloads and producer-schema coupling)
  section: "## Event carry: fat vs thin"

- id: event-driven:retry-budget-length
  rule: How much total retry time before dead-lettering.
  options: short, minutes 5–15 (fits a synchronous dependency someone waits on, dead-letters real traffic during a 90-second blip) | long, hours (rides out batch and back-office outages, one poison message eats subscriber throughput for days)
  section: "## Poison messages and DLQ policy"

- id: event-driven:retry-in-place-or-retry-topic
  rule: Where the retry wait happens.
  options: in place (simple, no extra topics, holds the partition or lease and stalls everything behind it) | delay queue / tiered retry topics (main partition keeps flowing, loses per-key ordering across the retry and adds topics and consumers to operate)
  section: "## Poison messages and DLQ policy"

- id: event-driven:choreography-or-orchestration
  rule: Saga as choreography vs orchestration.
  options: choreography (no central owner, autonomous teams, state unqueryable without reconstructing logs and a new step edits several services) | orchestration (queryable state, per-step timeouts and approvals, single point of coupling that can grow into a god service)
  section: "## Saga vs distributed transaction"

- id: event-driven:read-model-now-or-later
  rule: Introduce a separate read model now vs stay on a denormalized query or materialized view.
  options: read model (serves diverged read shapes and read/write ratios, adds a store, a projector, an out-of-sync mode, a rebuild procedure, and loses free read-your-own-writes) | same store (most of the benefit at a fraction of the cost, hits a wall once reads need cross-aggregate aggregation)
  section: "## CQRS and read models"
