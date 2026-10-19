# distributed-correctness — review checklist

Derived from ../SKILL.md. Read by `code-reviewer` and `workload-reviewer` through the `change-review` skill (defects; silences and trade-offs in a design or spec review) and by `grilling` (trade-offs). Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md.

Outbox, inbox, saga, DLQ and consumer-idempotency items live in `event-driven-patterns/references/review-checklist.md`; retry classes and budgets in `resilience-patterns/references/review-checklist.md`; single-database isolation in `sql-tuning/references/review-standard.md`. Do not report the same finding twice.

## defects
Objectively checkable in a diff or config. A match is a finding.

- id: dist:dual-write
  rule: Two writes to two systems with no shared transaction are not atomic; one system is written and the other derived, or the second write is idempotent and re-driven.
  check: A commit to one store followed in the same handler by a broker send, cache set, index put or HTTP call to another service, with no outbox, CDC, intent record or reconciliation job that re-drives the second write after a crash.
  section: "## Dual writes"

- id: dist:timeout-treated-as-failure
  rule: A response timeout on a remote write is an unknown outcome, not a failure.
  check: Code that rolls back, compensates, or reports failure for the first write when the second write times out, without first establishing whether the second write was applied.
  section: "## Dual writes"

- id: dist:weak-read-drives-write
  rule: A read that drives a write is at least as strong as the invariant needs.
  check: Balance, stock, uniqueness or permission read from a replica, cache, default DynamoDB read or GSI, followed by a write that depends on it, with no conditional write on the source of truth and no strong-read option.
  section: "## Consistency models: what a reader may see"

- id: dist:session-guarantee-unpinned
  rule: Read-your-writes and causal guarantees hold only while the client sticks to one node or carries a position token.
  check: A read path that relies on seeing the caller's own write but is load-balanced across replicas with no stickiness and no log-position/version token the replica waits for.
  section: "## Consistency models: what a reader may see"

- id: dist:cross-service-check-then-act
  rule: There is no isolation between steps of a cross-service workflow; re-validate at commit on the owning store.
  check: Service A reads a value from service B, decides, then writes to its own store with no version check or conditional write; or two services each check half of one invariant and both proceed; or a saga's intermediate state is readable as final with no PENDING status.
  section: "## Isolation across services"

- id: dist:replica-read-after-write
  rule: A read from an asynchronous replica can miss the user's own write.
  check: Write to the primary followed by a read of the same data from a replica in the same user flow (redirect-after-save, list after create) with no primary-read window, position wait, or remote_apply.
  section: "## Read replicas and replication lag"

- id: dist:cache-delete-before-write
  rule: Update the source of truth first, then delete the cache entry; prefer delete over set.
  check: Cache delete before the database write; or `cache.Set(newValue)` after the write instead of a delete.
  section: "## Cache consistency"

- id: dist:cache-stale-set-unbounded
  rule: Store-then-delete still has a stale-set race; bound it with a TTL, a versioned set, or leases.
  check: Cache-aside fill path that sets the loaded value with no TTL, no version comparison and no lease token.
  section: "## Cache consistency"

- id: dist:cache-no-ttl
  rule: Every cache-aside entry has a TTL so a missed invalidation is bounded.
  check: Cache set with no expiry on data that has a writable source of truth.
  section: "## Cache consistency"

- id: dist:cache-stampede
  rule: A hot key's expiry must not send every concurrent reader to the store.
  check: Hot-path cache miss that loads from the store with no per-key coalescing (singleflight or equivalent), no fill lease or rate limit, no serve-stale-while-refresh, and TTLs written together with no jitter.
  section: "## Cache consistency"

- id: dist:wall-clock-ordering
  rule: Never order events from different hosts by wall-clock time.
  check: ORDER BY or last-write-wins on a timestamp written by several hosts; stale-event discard comparing timestamps from two producers; expiry computed by comparing a timestamp written on host A with now() on host B.
  section: "## Clocks and ordering"

- id: dist:wall-clock-duration
  rule: Measure durations with the monotonic clock.
  check: Timeouts, lease lengths or elapsed checks computed by subtracting wall-clock readings (e.g. Unix timestamps, a Go time stripped by Round/Truncate/UTC or deserialized), or a deadline persisted and later compared as if monotonic.
  section: "## Clocks and ordering"

- id: dist:lock-without-fencing
  rule: A lease-based lock used for correctness is fenced, or replaced by a conditional write on the resource.
  check: Acquire lock → write to a store → release, where the write carries no fencing token, version or condition; or a lock TTL shorter than the guarded work's p99.9 duration.
  section: "## Distributed locks, leases and fencing"

- id: dist:lock-unsafe-release
  rule: Release a lock with compare-and-delete on the holder's unique value.
  check: Lock released with plain `DEL key` (or equivalent) instead of compare-and-delete / `DELEX ... IFEQ`; lock value not unique per acquisition.
  section: "## Distributed locks, leases and fencing"

- id: dist:lock-instead-of-conditional-write
  rule: When the resource supports a conditional write, use it rather than an external lock.
  check: External lock guarding a single-row update on a store that supports `UPDATE ... WHERE version = ?`, compare-and-set, a unique constraint or a condition expression.
  section: "## Distributed locks, leases and fencing"

- id: dist:leader-work-not-duplicate-safe
  rule: Leader work is safe if two leaders run it at once.
  check: Leader-only job whose effects are not idempotent, not fenced by term or lease revision, or performed without checking remaining lease time before each external effect.
  section: "## Leader election and split brain"

- id: dist:lease-wall-clock-expiry
  rule: Leases are measured in local elapsed time, never by comparing another host's timestamp with the local wall clock.
  check: `lease.expiresAt < now()` where expiresAt was written by another host.
  section: "## Leader election and split brain"

- id: dist:retry-without-idempotency-key
  rule: A retried write carries an idempotency key reused across all attempts of the same intent.
  check: Retry wrapper around a create/charge/send call with no idempotency key; key generated inside the retry loop; service that accepts a key but does not reject the same key with different parameters.
  section: "## Exactly-once means effectively-once"

- id: dist:idempotency-record-dual-write
  rule: The idempotency key record and the mutation commit in one transaction.
  check: Key stored in a different store (e.g. Redis) from the mutation (e.g. Postgres), or stored in a separate transaction.
  section: "## Exactly-once means effectively-once"

- id: dist:duplicate-returns-error
  rule: A duplicate request returns the original outcome, not an error.
  check: Repeat of a known key answered with 409/"already exists" or a failure instead of the original or semantically equivalent response.
  section: "## Exactly-once means effectively-once"

- id: dist:order-lost-at-hop
  rule: Order is lost at every hop that does not preserve it.
  check: Worker pool or goroutine/thread per message inside an ordered partition consumer with no per-key serialization; parallel outbox publishers; retry topic redelivering after later messages, where the consumer depends on order.
  section: "## Ordering guarantees"

- id: dist:stale-discard-by-timestamp
  rule: Consumers that cannot rely on order discard stale updates by owner-assigned version.
  check: Out-of-order handling that compares event timestamps instead of a version or sequence assigned by the entity's owner.
  section: "## Ordering guarantees"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: dist:source-of-truth-unstated
  rule: Each piece of data has a named source of truth; other copies are derived, and multi-writer fields have a conflict rule.
  check: Data held in two or more stores with no statement of which is authoritative, or two writable copies with no conflict rule.
  section: "## Dual writes"

- id: dist:read-model-unstated
  rule: The consistency model is named per read path, not per system.
  check: Read paths through replicas, caches or indexes with no "fresh" / "read-your-writes" / "stale by up to N" label.
  section: "## Consistency models: what a reader may see"

- id: dist:cross-service-invariant-owner-unstated
  rule: Each cross-service invariant names the enforcing service and when it is checked.
  check: An invariant spanning services described as "both services validate" or with no owner.
  section: "## Isolation across services"

- id: dist:failover-loss-unstated
  rule: The replication mode and the failover data-loss window it accepts are stated.
  check: Replicated store with no stated sync/async mode and no accepted loss window on promotion.
  section: "## Read replicas and replication lag"

- id: dist:replication-lag-unmonitored
  rule: Replication lag is monitored with an alert threshold matching the stale bound read paths assume.
  check: "Stale by up to N" read paths with no lag metric or alert at or below N.
  section: "## Read replicas and replication lag"

- id: dist:cache-freshness-unclassified
  rule: Each cached read is classified stale-acceptable or must-be-fresh, with its bound.
  check: Cached authorization, price-being-charged or balance data with no freshness classification; any cached read with no staleness bound.
  section: "## Cache consistency"

- id: dist:cross-region-cache-lag-unstated
  rule: Cross-region caches state how replica lag interacts with invalidation.
  check: Regional cache filled from a regional replica with no statement of what happens when a fill follows the delete before replication catches up.
  section: "## Cache consistency"

- id: dist:lock-purpose-unstated
  rule: Every distributed lock states whether it is for efficiency or for correctness.
  check: A distributed lock introduced with no statement of what breaks if two holders run at once.
  section: "## Distributed locks, leases and fencing"

- id: dist:custom-election
  rule: Leader election uses an existing lease implementation, or states why not and tests two candidates through a pause.
  check: Hand-written election or lease code with no stated reason and no two-candidate pause test.
  section: "## Leader election and split brain"

- id: dist:idempotency-retention-unstated
  rule: Idempotency key retention is stated and covers the longest retry or replay window.
  check: Idempotency keys with no retention period, or one shorter than the caller's retry/replay window.
  section: "## Exactly-once means effectively-once"

- id: dist:order-unit-unstated
  rule: Every order-dependent consumer states the unit of order it relies on.
  check: Consumer logic that assumes order with no stated partition/ordering-key unit.
  section: "## Ordering guarantees"

- id: dist:guarantee-setting-unstated
  rule: A design relying on a store-level guarantee names the setting and version that provide it.
  check: "X is strongly consistent / serializable / exactly-once" with no write concern, read concern, ConsistentRead, synchronous_commit or isolation level and no version.
  section: "## Measured evidence: guarantees as configured, not as advertised"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: dist:clock-scheme
  rule: Hybrid logical clock vs TrueTime vs owner-assigned sequence numbers for ordering.
  options: owner sequence number (simplest, enough when one writer owns the entity, no cross-entity order) | hybrid logical clock (causal order close to physical time, 64 bits, no waiting, no real-time order between unrelated events) | TrueTime-style commit wait (external consistency, needs bounded-uncertainty clock hardware — Spanner only; on NTP clocks it guarantees nothing)
  section: "## Clocks and ordering"

- id: dist:redlock
  rule: Redlock (Kleppmann vs antirez) vs single-instance lock vs consensus lock with fencing.
  options: single Redis instance with SET NX PX and compare-and-delete (enough for efficiency locks, approximate) | Redlock (survives single-node loss; Kleppmann: relies on synchronous timing and cannot fence; antirez: needs only bounded clock-rate error and can use random-token check-and-set) | consensus store (ZooKeeper, etcd) plus fencing tokens enforced by the resource (correctness, more infrastructure; etcd locks alone measured unsafe by Jepsen)
  section: "## Distributed locks, leases and fencing"

- id: dist:strong-or-eventual-read
  rule: Strong vs eventual consistency per read path.
  options: strong (correct check-then-act, higher latency, unavailable on some nodes during a partition, double read cost on DynamoDB) | eventual (cheap and available, every consumer and the UX must tolerate stale values) | session guarantees (read-your-writes via stickiness or position token — middle ground, lost when the client moves nodes)
  section: "## Consistency models: what a reader may see", "## CAP and PACELC, only where they change a decision"

- id: dist:replica-read-after-write-fix
  rule: How to give read-after-write on replicas.
  options: primary read for a short window after the session's write (simple, adds primary load) | replica waits for the commit's log position (precise, needs the position plumbed through) | synchronous_commit = remote_apply (all reads on the sync standby see commits, every commit pays standby replay latency)
  section: "## Read replicas and replication lag"

- id: dist:stampede-mitigation
  rule: Which stampede mitigation for a hot key.
  options: in-process coalescing (cheap, still N loads for N replicas) | cross-process fill lease or lock (one load cluster-wide, adds a wait and a coordination point) | serve stale while one caller refreshes (no wait, only for stale-acceptable reads) | TTL jitter (spreads expiry, does not help a single hot key)
  section: "## Cache consistency"

- id: dist:dual-write-repair
  rule: Outbox/CDC vs idempotent re-drive vs accept-and-reconcile for a second write.
  options: write one system and derive the other (strongest, needs a relay or CDC) | intent record plus idempotent re-drive (works for external APIs, needs a worker and reconciliation) | accept divergence and reconcile periodically (cheapest, only for derived data with a named job and divergence bound)
  section: "## Dual writes"
