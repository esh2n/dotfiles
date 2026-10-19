---
name: distributed-correctness
description: Use when a change spans more than one process or store — two writes that must agree (database plus queue, cache or external API), a cross-service workflow, a cache, a read replica, timestamps compared across hosts, leader election, a distributed lock or lease, an "exactly-once" claim, or an idempotent consumer — and when diagnosing stale reads, lost updates, two leaders, a lock held twice, duplicate side effects, events applied out of order, or a cache that serves an old value forever.
metadata:
  namespaces: [arch/patterns]
---

# Distributed Correctness

Judgment criteria for state that lives in more than one place. A single
database transaction gives atomicity and isolation for free; the moment a
change touches two stores, two services, a cache or a replica, those
guarantees stop at the boundary and the design has to say what replaces them.

This skill owns the general problems. It links instead of repeating:

- `event-driven-patterns` — transactional outbox, inbox, sagas, DLQ, consumer
  idempotency and idempotency key choice, per-partition ordering keys.
- `resilience-patterns` — which errors to retry, retry budgets, jitter,
  timeouts and deadlines.
- `sql-tuning/references/review-standard.md` — isolation levels and anomalies
  inside one PostgreSQL or Spanner database (§4 "Transactions, isolation and
  locking", §6 "Concurrency model").

## Dual writes

**[defect] Two writes to two systems with no shared transaction are not
atomic, whatever order they run in.** A process can die, time out or be
redeployed between them. Database then broker loses the event; broker then
database publishes something that never committed. The same holds for
database plus cache, database plus search index, and database plus a
third-party API: there is no order that is safe, only an order whose failure
is easier to repair. Debezium's description of the order-service example
shows both failure directions and why Kafka cannot join the database
transaction
(https://debezium.io/blog/2019/02/19/reliable-microservices-data-exchange-with-the-outbox-pattern/).

Pattern-match in a diff: `tx.Commit()` followed by `producer.Send`,
`cache.Set`, `index.Put` or an HTTP call to another service in the same
handler, with nothing that re-drives the second write after a crash.

**[trade-off]** The repairs, in order of preference — each later one is
cheaper and weaker:

1. **Write one system and derive the other from it** — the outbox or change
   data capture (`event-driven-patterns` § Transactional outbox). Only one
   resource is modified in the request; the second follows at least once.
2. **Make the second write idempotent and re-drivable** — record intent in
   the first store, then a worker or reconciliation job retries the second
   until it is confirmed (`event-driven-patterns` § Idempotency key design,
   the claim → confirm branch for external APIs).
3. **Accept divergence and reconcile** — only when the second write is
   derived data a periodic job rebuilds (a cache, a search index), and the
   design names the job and how long divergence may last.

**[defect] A response timeout on the second write is not a failure.** The
request may have been applied, rejected, or never processed; the caller
cannot tell which (AWS Builders' Library, "Challenges with distributed
systems", the eight failure modes and the UNKNOWN outcome:
https://builder.aws.com/content/3F08f7GPFiZMCgXD8gny6OjxR0Z/challenges-with-distributed-systems).
Code that treats a timeout as "did not happen" and rolls back or compensates
the first write produces the inverse divergence.

**[silence] The design states which store is the source of truth for each
piece of data,** and that every other copy is derived from it. Two stores
that both accept writes for the same field need a conflict rule, and a
design that has not written one has picked "last writer wins by accident".

## Consistency models: what a reader may see

Name the model each read path relies on, then check the store actually
provides it under the configuration used. Jepsen's hierarchy
(https://jepsen.io/consistency/models) is the reference:

| Model | A reader may see | Available during a partition |
|---|---|---|
| Linearizable | Only the latest completed write; real-time order respected, per object (https://jepsen.io/consistency/models/linearizable) | No — some nodes must refuse |
| Sequential | One order all processes agree on, but it may lag real time — a stale value is legal (https://jepsen.io/consistency/models/sequential) | No |
| Causal | Effects never before their causes; concurrent writes in different orders on different nodes (https://jepsen.io/consistency/models/causal) | Sticky — only if the client stays on one node |
| Read your writes | Its own writes; nothing about other clients' writes (https://jepsen.io/consistency/models/read-your-writes) | Sticky |
| Eventual | Any older value during the inconsistency window; converges only if writes stop (Vogels, https://www.allthingsdistributed.com/2008/12/eventually_consistent.html) | Yes |

Strict serializable is serializable plus linearizable; snapshot isolation and
repeatable read are incomparable with each other (same Jepsen page).

**[defect] A read that drives a write must be at least as strong as the
invariant needs.** Reading a balance, stock count, uniqueness check or
permission from an eventually consistent source (a replica, a cache, a
DynamoDB default read, a GSI) and then writing on the strength of it lets two
callers both pass the check. DynamoDB reads are eventually consistent unless
`ConsistentRead` is set, and GSI and stream reads cannot be strongly
consistent at all
(https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html).
Move the check into a conditional write on the source of truth, or read with
the strong option.

**[defect] Session guarantees are per client and only "sticky".** Read your
writes and causal consistency hold only while the client keeps talking to
the same node, or carries a token (a log position, a version) that the next
node waits for. A load balancer that spreads one user's requests across
replicas silently drops the guarantee.

**[silence] The design names the model per read path, not per system.** "The
database is strongly consistent" says nothing when the read in question goes
to a replica, a cache or an index. Write it next to each read: "fresh",
"read-your-writes", or "stale by up to N seconds is acceptable".

## Isolation across services

**[defect] There is no isolation between steps of a cross-service workflow.**
A saga is atomic only through compensation and has no "I": another request
can read the intermediate state between step 2 and its compensation
(Richardson, saga pattern, "lack of isolation":
https://microservices.io/patterns/data/saga.html). The anomalies are the
ones the SQL isolation table describes inside one database — lost update,
dirty read of a state that is later compensated, write skew across two
services' checks — but no database setting prevents them, because no single
database sees both writes.

Pattern-match: service A reads a value from service B, decides, then writes
to A's store; or two services each check their own half of an invariant
("credit available", "seat free") and both proceed.

- Make the state explicit — a `PENDING` status other readers must respect
  until the workflow finishes, so the intermediate state is visible as
  intermediate rather than as fact.
- Re-validate at the point of commit with a conditional write or version
  check on the owning store, not with the value read earlier from another
  service.
- Keep the invariant inside one service's transaction where possible; an
  invariant split across two services is the design smell, the anomaly is the
  symptom.

**[silence] For every cross-service invariant, the design names the service
that enforces it and the moment it is checked.** "Both services validate" is
not an answer: two checks in two transactions is the write-skew shape.

Inside one database, isolation levels and their anomalies belong to
`sql-tuning/references/review-standard.md` §6. Measured evidence that the
label is not the behavior: Jepsen found PostgreSQL 12.3's Serializable
admitted G2-item cycles through a bug, and that its Repeatable Read is
snapshot isolation, which allows anomalies formal repeatable read forbids
(https://jepsen.io/analyses/postgresql-12.3).

## Read replicas and replication lag

**[defect] A read from an asynchronous replica can return data older than a
write the same user just made.** PostgreSQL documents standby data as
eventually consistent with a measurable delay
(https://www.postgresql.org/docs/current/hot-standby.html#HOT-STANDBY-USERS).
Write-then-redirect-then-read-from-replica is the common shape: the user
saves, the next page reads the replica, the change is missing.

**[trade-off]** Fixes, cheapest first: read the primary for a short window after the
session's own write; pass the commit's log position and have the replica
wait for it; or use `synchronous_commit = remote_apply`, which makes the
commit wait until the synchronous standby has replayed it — PostgreSQL
describes this as giving causal consistency for load-balanced reads, at the
cost of commit latency
(https://www.postgresql.org/docs/current/warm-standby.html#SYNCHRONOUS-REPLICATION-CONFIG).

**[silence] Failover data loss is stated.** With asynchronous replication,
transactions committed on the primary but not yet shipped are lost when a
replica is promoted, in proportion to the lag at that moment
(https://www.postgresql.org/docs/current/warm-standby.html#STREAMING-REPLICATION).
The design names the replication mode and the loss window it accepts.

**[silence] Lag is monitored and has an alert threshold** —
`pg_stat_replication` on the primary, `pg_stat_wal_receiver` on the standby
(https://www.postgresql.org/docs/current/warm-standby.html#STREAMING-REPLICATION-MONITORING).
A "stale by up to N seconds" read path is only true while lag stays under N.

## Cache consistency

**[defect] On write, update the source of truth first, then delete the cache
entry — never delete first, and prefer delete over set.** Deleting first
leaves a window where a concurrent reader misses, loads the old value from
the store and writes it back into the cache (Microsoft cache-aside pattern,
the ordering note:
https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside).
Facebook's memcache deletes rather than updates because a delete is
idempotent and the cache is not authoritative (Nishtala et al., "Scaling
Memcache at Facebook", NSDI '13, §2:
https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf).
A `cache.Set(newValue)` after the database write races with another writer's
set and can leave the older value cached with no expiry to rescue it.

**[defect] Even store-then-delete has a stale-set race.** Reader A misses
and reads the old value; writer B updates the store and deletes the key;
reader A then sets the old value. The cache now holds stale data until TTL.
Fixes: a TTL on every cache-aside entry as the upper bound of staleness;
a versioned set (set only if the version is newer); or memcache-style leases,
where a miss returns a token bound to the key, a delete invalidates the
token, and a set with an invalidated token is refused (Nishtala et al., §3.2.1).

**[defect] A cache entry with no TTL turns every missed invalidation into a
permanent wrong answer.** Invalidation messages are a dual write and will be
lost sometimes; the TTL is the bound on how long.

**[defect] A hot key that expires sends every concurrent reader to the
store at once (stampede, thundering herd).** **[trade-off]** Which
mitigation fits depends on replica count and freshness class:

- Per-key request coalescing so one caller loads and the rest wait for its
  result. Go's `singleflight.Group.Do` does this within one process
  (https://pkg.go.dev/golang.org/x/sync/singleflight); with N replicas the
  store still sees up to N loads.
- Cross-process: rate-limit who may fill. Facebook's leases hand out one fill
  token per key per 10 seconds and tell other clients to wait briefly; they
  measured peak database queries on stampede-prone keys falling from 17K/s to
  1.3K/s (Nishtala et al., §3.2.1).
- Serve the stale value while one caller refreshes, where the read path is
  classified stale-acceptable (`resilience-patterns` § Graceful degradation).
- Jitter TTLs so entries written together do not expire together.

**[silence] Each cached read is classified as stale-acceptable or
must-be-fresh, with its bound.** Cache-aside gives no consistency guarantee
with the store; between a write and the next fill a reader can see the old
value (Microsoft, "Consistency" and "Staleness after writes"). Per-instance
in-memory caches diverge from each other as well. Authorization, prices
being charged and balances are must-be-fresh unless the design argues
otherwise.

**[silence] Cross-region caches state how replica lag interacts with
invalidation.** A fill from a lagging regional replica after the delete
re-caches old data; Facebook's remote markers route a miss to the primary
region while a write is in flight (Nishtala et al., §5).

## Clocks and ordering

**[defect] Never order events from different hosts by wall-clock time.**
Wall clocks are adjusted by NTP, can jump backward, and differ between hosts
by an amount you do not know; when two hosts' uncertainty intervals overlap,
physical time cannot order their events (Kulkarni et al., "Logical Physical
Clocks", §1: https://cse.buffalo.edu/tech-reports/2014-04.pdf). Amazon avoids
synchronized clocks for ordering or coordination and keeps time mostly for
humans (AWS Builders' Library, "Leader election in distributed systems":
https://builder.aws.com/content/3Ev0vH0hfkcUizISUWYTvHibtcp/leader-election-in-distributed-systems).

Pattern-match: `ORDER BY created_at` over rows written by several services to
decide which update wins; last-write-wins merge keyed on `updated_at` from the
writer's clock; "discard events older than the one we have" comparing
timestamps from two producers; an expiry check comparing a timestamp written
by host A with `now()` on host B.

Use instead: a version or sequence number assigned by the single owner of the
entity (a database sequence, a row version, a per-partition offset), a
logical clock, or a hybrid logical clock.

**[defect] Measure durations with the monotonic clock.** Timeouts, lease
lengths and elapsed-time checks computed from wall-clock subtraction break
when the clock is stepped. Go's `time.Now()` carries both readings and
`Sub`/`Since` use the monotonic one, but `Round`, `Truncate`, `UTC`, and any
serialization strip it
(https://pkg.go.dev/time#hdr-Monotonic_Clocks) — a deadline stored in a
database or sent to another host is wall time again. Redis TTL expiry does not
use a monotonic clock, so a wall-clock shift can let two clients hold the same
lock (Redis distributed-locks page, "Disclaimer about consistency":
https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/).

**[trade-off] Hybrid logical clocks vs TrueTime vs plain sequence numbers.**

- A hybrid logical clock combines a physical reading with a logical counter:
  it respects causality like a Lamport clock, stays close to NTP time, fits in
  64 bits, and needs no waiting out of clock uncertainty (Kulkarni et al.,
  abstract and the related-work comparison with Spanner). It does not give real-time order between causally
  unrelated events.
- TrueTime is Spanner-specific: `TT.now()` returns an interval guaranteed to
  contain absolute time, backed by GPS and atomic clocks, with uncertainty
  typically 1–7 ms; Spanner waits out the uncertainty before making a commit
  visible (commit wait), and that is what gives external consistency (Corbett
  et al., "Spanner", §3 and §4.1.2:
  https://storage.googleapis.com/gweb-research2023-media/pubtools/1974.pdf;
  https://docs.cloud.google.com/spanner/docs/true-time-external-consistency).
  Without bounded-uncertainty hardware the technique does not transfer;
  copying "wait a few ms" onto NTP clocks gives no guarantee.
- A sequence number from the entity's owner is the simplest and is enough
  whenever one writer owns the entity.

## Distributed locks, leases and fencing

**[silence] Every distributed lock states whether it is for efficiency or
for correctness.** An efficiency lock prevents duplicate work; a failure costs
a repeated email or a wasted computation. A correctness lock protects data;
a failure corrupts it. Kleppmann's recommendation: a single Redis instance
with `SET NX PX` and a compare-and-delete release is enough for efficiency,
and correctness needs a consensus system plus fencing
(https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html).

**[defect] A lease-based lock used for correctness without fencing is
unsafe.** The holder can pause — GC, page fault, a delayed packet — past its
lease, another client acquires the lock and writes, and the first resumes and
writes too; checking the lease right before the write does not close the gap
(Kleppmann, same post). This is not a Redis-specific problem: Jepsen measured
etcd 3.4.3 locks held by several processes at once in healthy clusters, losing
about 18% of acknowledged updates under 2-second TTLs and pauses, and
recommended using the lock key's revision as a fencing token
(https://jepsen.io/analyses/etcd-3.4.3).

Fencing: the lock service hands out a strictly increasing token with each
grant; the protected resource remembers the highest token it has accepted and
rejects writes carrying a lower one. The resource has to do the check —
a token the resource ignores fences nothing.

Pattern-match: `lock.Acquire(); doWork(); store.Write(x); lock.Release()`
where `store.Write` carries no token or version; a lock whose TTL is shorter
than the work's p99.9 duration; `DEL key` as release instead of
compare-and-delete (deletes another client's lock after expiry, Redis page,
"Correct Implementation with a Single Instance").

**[trade-off] Redlock: Kleppmann vs antirez.** Present both; neither is a
settled fact.

- Kleppmann: Redlock's safety rests on bounded network delay, bounded pauses
  and clocks that do not jump — a synchronous system model real networks do
  not provide — and it cannot generate fencing tokens, so it is too heavy for
  efficiency and too weak for correctness
  (https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html).
- antirez: Redlock needs only bounded relative clock-rate error, not
  synchronized clocks; a resource able to enforce monotonic tokens is already
  linearizable and arguably does not need the lock; a random unique token
  used for check-and-set on the resource serves the same purpose; a pause
  after the final validity check affects every auto-expiring lock, not
  Redlock alone. He agreed Redis should move to a monotonic clock
  (http://antirez.com/news/101).
- The Redis docs today tell correctness-sensitive users to implement fencing
  tokens and warn that TTL expiry is not on a monotonic clock (Redis page,
  "Disclaimer about consistency").

The decision this changes: if the lock guards correctness, the reviewer asks
for fencing or a conditional write on the resource whichever lock is used; if
it guards efficiency, a single-instance lock is enough and Redlock's extra
nodes buy little.

**[defect] The safest lock is often no lock.** When the protected resource
supports a conditional write (`UPDATE ... WHERE version = ?`, compare-and-set,
a unique constraint, a DynamoDB condition expression), use it directly: the
resource enforces exclusion at the moment of the write, which no external lock
can.

## Leader election and split brain

**[defect] Leader election cannot guarantee exactly one leader.** During
failures there may be zero or two (AWS, "Leader election in distributed
systems"). client-go's leader election says so in its package doc: it does not
guarantee only one client acts as leader, tolerates clock offsets but not
differing clock rates, and with `ReleaseOnCancel` the guarded work must have
finished before cancelling
(https://pkg.go.dev/k8s.io/client-go/tools/leaderelection). Asynchronous
replica promotion is a split-brain source in its own right: a lock written to
a primary that crashes before replicating is absent on the promoted replica
(Redis page, "Why Failover-based Implementations Are Not Enough").

Therefore the work a leader does must be safe if two leaders do it at once:

- Make leader work idempotent and durable before announcing completion, so a
  new leader can redo a half-finished step (AWS, same article).
- Fence the leader's writes with its term or lease revision, as with locks.
- Check the remaining lease before every operation with effects outside the
  leader, and leave margin for network delay, retries and GC pauses (AWS).

**[defect] Leases are measured in local elapsed time, never by comparing a
timestamp from the lease record with the local wall clock** (AWS; client-go
doc). A lease expiry check that reads `lease.expiresAt < time.Now()` with
`expiresAt` written by another host is a wall-clock comparison across hosts.

**[silence] Use an existing lease implementation.** AWS prefers well-tested
lease clients (DynamoDB lock client, ZooKeeper) over custom election code
(AWS, same article). A hand-written election in a diff needs a stated reason
and a test that runs two candidates through a pause.

## Exactly-once means effectively-once

**[defect] "Exactly-once" across a network is at-least-once delivery plus
idempotent processing.** A retried request whose first attempt timed out is
the UNKNOWN case above; the only way to make the retry safe is for the
receiver to recognize it. Broker-level exactly-once bounds and consumer dedup
are in `event-driven-patterns` § Delivery semantics and § Idempotency key
design; this section covers synchronous APIs and the general claim.

**[defect] A retried write without an idempotency key is a duplicate
waiting to happen.** AWS's design: the caller sends a unique client request
token, reused on every retry of the same intent; the service records the
token atomically with the mutation; a repeat returns a semantically
equivalent response; the same token with different parameters is a
validation error; tokens are retained for a defined period
(https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/).
Pattern-match: a retry wrapper (`resilience-patterns` § Retry judgment) around
a `POST` that creates or charges something, with no key header; a key
generated inside the retry loop, so each attempt has a new one.

**[defect] The key record and the mutation commit in one transaction.**
Recording the key in Redis and the mutation in Postgres is itself a dual
write. Same rule as the inbox (`event-driven-patterns` § Idempotency key
design).

**[defect] A duplicate request returns the original outcome, not an error.**
Returning "already exists" makes callers believe someone else created the
resource (AWS, same article).

**[silence] Key retention is stated** and covers the longest retry or replay
window a caller can produce.

Measured evidence that "retries are handled" is not enough: Jepsen found
MongoDB 4.2.6 transactions applied more than once under partitions, with
transactions ignoring the `retryWrites` setting
(https://jepsen.io/analyses/mongodb-4.2.6).

## Ordering guarantees

**[silence] Every consumer that depends on order states the unit of order
it relies on.** Kafka and Kinesis order within a partition, Pub/Sub within an
ordering key, and nothing orders across them (`event-driven-patterns` §
Topology and fan-out, which owns key choice and head-of-line blocking).

**[defect] Order is lost at every hop that does not preserve it** — a
consumer that processes a partition with a worker pool, a retry topic that
redelivers a failed message after later ones, an outbox relay with several
parallel publishers, two producers writing the same entity. Pattern-match:
`go handle(msg)` or a thread pool inside a partition consumer with no per-key
serialization.

**[defect] Consumers that cannot rely on order discard stale updates by
version, not by timestamp.** Carry the owner-assigned version on each event
and apply only if it is newer than the stored one (§ Clocks and ordering).

## CAP and PACELC, only where they change a decision

Use them to ask two concrete questions, never as a label for a system.

- **During a partition** (CAP), will this read path refuse or answer with
  possibly stale data? Linearizable and sequential reads must refuse on some
  nodes; causal and read-your-writes stay available only for clients that
  stick to one node (Jepsen models page).
- **Else, in normal operation** (the "ELC" of PACELC), is the path paying
  latency for consistency — synchronous replication, a quorum read, a primary
  read across regions — and is that latency in its budget? Abadi's point is
  that this second trade-off applies to every replicated system all the time,
  not only during partitions (Abadi, "Consistency Tradeoffs in Modern
  Distributed Database System Design", IEEE Computer 2012:
  https://www.cs.umd.edu/~abadi/papers/abadi-pacelc.pdf).

**[trade-off] Strong vs eventual per read path.** Strong: correct
check-then-act, higher latency, unavailable on some nodes during a partition,
and on DynamoDB twice the read cost. Eventual: cheap and available, and every
consumer must tolerate stale values — the UX and the invariant checks have to
be designed for it (`event-driven-patterns` § CQRS and read models).

## Measured evidence: guarantees as configured, not as advertised

Jepsen analyses are the negative evidence to cite when a design leans on a
store's claimed guarantee. Check the configuration, the version and whether an
analysis exists before accepting the claim.

- Redis-Raft (2020): stale reads in healthy clusters, split brain and lost
  updates during membership changes (https://jepsen.io/analyses/redis-raft-1b3fbf6).
- MongoDB 4.2.6 (2020): read skew and cyclic information flow at the
  strongest settings; transaction read and write concern default to weak
  values unless set per transaction (https://jepsen.io/analyses/mongodb-4.2.6).
- etcd 3.4.3 (2020): key-value operations strict serializable; locks not safe
  without fencing (https://jepsen.io/analyses/etcd-3.4.3).
- PostgreSQL 12.3 (2020): Serializable bug and Repeatable Read as snapshot
  isolation (https://jepsen.io/analyses/postgresql-12.3).

**[silence] A design that relies on a store-level guarantee names the setting
that provides it** (write concern, read concern, `ConsistentRead`,
`synchronous_commit`, isolation level) and the version, not the product name.

## Related

- `event-driven-patterns` (same pack) — outbox, inbox, sagas, DLQ, consumer
  idempotency, ordering keys.
- `resilience-patterns` (same pack) — retry classes, budgets, jitter,
  timeouts, graceful degradation.
- `sql-tuning` — isolation levels, check-then-act and serialization retries
  inside one database.
- `ddd-modeling-review` — where an invariant belongs, which decides whether
  it can stay inside one transaction.
- Kleppmann, *Designing Data-Intensive Applications* (O'Reilly, 2017) —
  background on replication, transactions, clocks and consensus; cited, not
  copied, and not opened for this skill (no claim above rests on it).
