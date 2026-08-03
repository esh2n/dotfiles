---
name: sql-tuning
description: Use when a query is slow, an EXPLAIN plan needs interpretation, designing or pruning indexes, diagnosing lock contention or hotspots, paginating large tables, or writing a schema migration for PostgreSQL or Cloud Spanner — judgment for reading plans, choosing index shape, and sequencing safe schema changes.
---

# SQL Tuning

Judgment criteria for diagnosing and fixing performance problems in
PostgreSQL and Cloud Spanner. This goes deeper on tuning judgment than the
**database-reviewer** agent — that agent runs the review checklist (indexed
columns, RLS, data types, anti-patterns); this skill is for the reasoning
behind an EXPLAIN plan, an index shape decision, or a migration sequencing
call. Use both together: database-reviewer for the pass/fail checklist,
this skill for "why is this actually slow."

## EXPLAIN reading judgment (Postgres)

Always run `EXPLAIN (ANALYZE, BUFFERS)`, never plain `EXPLAIN`. A plan
without ANALYZE only shows what the planner *guesses* it will do — it never
proves what actually happened, and BUFFERS is the only view into disk vs.
cache activity, which is usually the real cost.

- **Rows estimate vs. actual is the first thing to check, not the scan
  type.** A `rows=10` estimate against `actual rows=50000` means the
  planner is flying blind — usually stale statistics. Run `ANALYZE
  <table>` before touching indexes; an index built on bad stats just moves
  the wrong choice somewhere else. Mismatches also show up after bulk
  loads/deletes before autovacuum catches up, or on correlated columns the
  planner can't model (fix with `CREATE STATISTICS ... (dependencies)`).
- **Seq Scan is not automatically the bug.** For a query that returns a
  large fraction of the table (low selectivity — e.g. >5-10% of rows), a
  sequential scan is often *cheaper* than an index scan plus the random
  I/O of visiting each row. Judge by selectivity, not by scan name — an
  Index Scan on an unselective predicate is the actual anti-pattern
  (thrashing random-access reads for no benefit).
- **Nested Loop blowups** happen when the planner's row estimate for the
  outer side is wrong (see above) and it expects a handful of outer rows
  but executes the inner side thousands of times. Fix the estimate first.
  If estimates are already accurate and a large nested loop is still
  chosen, check `work_mem` — too low a setting biases the planner away
  from Hash/Merge Join even when they'd be cheaper.
- **Buffers and temp spills tell you where the actual cost is.**
  `Buffers: shared read=` (not `hit=`) means it went to disk, not cache —
  a repeated query with a high read ratio points at either a cold cache or
  a working set bigger than `shared_buffers`. `Sort Method: external
  merge Disk` or any `temp` line means the operation spilled past
  `work_mem` — either the row count estimate was wrong (see above) or
  `work_mem` is genuinely too small for that query's real data volume.
- Read plans bottom-up: the innermost node's actual time and row count
  determine everything above it. A slow top-level Sort is frequently a
  symptom of a bad estimate three nodes down, not a sort problem.

## Index design decision-making

- **Composite column order: equality columns first, then range, then the
  sort/ORDER BY column.** Equality predicates narrow the B-tree scan to a
  contiguous range immediately; a range predicate placed before an
  equality column can't be used to narrow anything and forces a wider
  scan. Placing the ORDER BY column last (after all filter columns) lets
  Postgres skip a separate sort node when the filtered range is already in
  index order.
- **Covering / `INCLUDE`** — add non-filtered, frequently-selected columns
  via `INCLUDE (col)` when a query is otherwise index-only-scan eligible
  but needs one extra column back. This avoids a heap fetch per row. Don't
  `INCLUDE` columns that change often — every update to an included column
  still has to update the index.
- **Partial index** when the predicate is stable and selective across the
  table's lifetime — `WHERE deleted_at IS NULL`, `WHERE status = 'pending'`
  on a queue table. The index stays small and cheap to maintain because
  most rows never enter it. Don't use a partial index for a predicate that
  drifts (today's "active" rows become tomorrow's excluded rows) — the
  index just grows to cover the whole table anyway with none of the
  benefit.
- **Expression index** (`CREATE INDEX ON t (lower(email))`) when queries
  filter on a function of a column rather than the raw column — a plain
  index on `email` cannot serve `WHERE lower(email) = $1`. The expression
  in the index definition must match the query's expression exactly
  (including collation) or the planner won't use it.
- **When NOT to add an index — write amplification is not free.** Every
  index is written on every INSERT/UPDATE/DELETE that touches its columns,
  and each one is a candidate for planner cost that has to be maintained
  even when unused. Before adding an index, ask whether the write path
  (especially a hot table) can absorb another write per row; a table with
  five rarely-used indexes is often slower to write than a table with two
  well-chosen ones.
- **Detect unused indexes** via `pg_stat_user_indexes`:
  ```sql
  SELECT relname, indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid))
  FROM pg_stat_user_indexes
  WHERE idx_scan = 0 AND indexrelname NOT LIKE '%_pkey'
  ORDER BY pg_relation_size(indexrelid) DESC;
  ```
  A near-zero `idx_scan` after a representative production window (not
  right after deploy — give it weeks, covering batch/reporting jobs too)
  is a drop candidate. Confirm it isn't a uniqueness/FK-integrity-only
  index before dropping — those show zero scans by design.

## N+1 and pagination

- N+1 query patterns aren't a plan-reading problem, they're an
  application-layer one: one query per row instead of a single joined or
  batched query. Look for a loop issuing a query per iteration; fix with a
  join, an `IN (...)` batch, or a dataloader-style batching layer.
- **Keyset (cursor) pagination over OFFSET at depth.** `OFFSET n` forces
  Postgres to scan and discard the first `n` rows every single page —
  cost grows linearly with page depth, so page 500 is far more expensive
  than page 1 even though it returns the same row count. Keyset
  pagination (`WHERE (created_at, id) < ($last_created_at, $last_id) ORDER
  BY created_at DESC, id DESC LIMIT n`) costs the same at any depth
  because it seeks directly via the index instead of counting through.
  OFFSET is fine for shallow, UI-driven "page 2 of a small result set";
  treat any deep-pagination or infinite-scroll/export use case as a
  keyset case by default.

## Lock contention judgment

- **Long-running transactions are the root cause behind most lock
  contention** — a transaction that opens, does an external API call or
  slow business logic, and only then commits holds its row/table locks for
  that entire wall-clock span. Diagnose with
  `SELECT pid, state, now() - xact_start AS duration, query FROM
  pg_stat_activity WHERE state != 'idle' ORDER BY duration DESC;` and fix
  by moving non-DB work outside the transaction boundary, not by tuning
  the query itself.
- **`SELECT ... FOR UPDATE` scope** — lock only the rows the transaction
  will actually modify; a broad filter locks every matching row for the
  transaction's duration and blocks unrelated writers. Narrow the WHERE
  clause, and for queue/worker patterns use `FOR UPDATE SKIP LOCKED` so
  contending workers grab different rows instead of queuing behind each
  other.
- **Advisory locks** (`pg_advisory_lock`/`pg_try_advisory_lock`) coordinate
  application-level critical sections that don't map to a specific row —
  e.g. a scheduled job that must not run twice concurrently. Don't reach
  for row locks to serialize logic that isn't actually about row data.
- **Hot-row patterns** — a shared counter row, a single queue-head row, or
  any row every writer touches serializes all writers on it regardless of
  indexing. Redesign: shard the counter across N rows and sum on read, or
  move to an append-only/event-log pattern instead of mutating one row.

## Spanner-specific tuning

See database-reviewer's Spanner review lanes for interleaving, PK
hotspotting, and mutation-vs-DML guidance — the tuning judgment beyond
that checklist:

- **Query plans are distributed, not local.** A Spanner plan shows which
  operations run at the root vs. pushed down to each split; a
  `Distributed Union`/`Distributed Cross Apply` fanning out across splits
  is inherently more expensive than a single-split read. Judge a plan by
  how much cross-split coordination it needs, not by node count alone.
- **Avoid cross-split joins on large tables.** A join between tables that
  aren't co-located (not interleaved, no shared key prefix) forces Spanner
  to shuffle data between splits. If frequent and one side is small,
  denormalize instead — interleave (see database-reviewer) or duplicate
  the small side's columns onto the large table.
- **Secondary index + STORING vs. base-table scan** — decide by whether
  the query is a point/range lookup on non-key columns (index candidate)
  vs. a scan needing most of the row anyway (base-table scan is simpler
  and avoids the extra write cost). Use `STORING` to keep a lookup
  index-only when it needs a few extra columns beyond the index key;
  don't STORE the whole row — that's a second copy of the table with
  index-write overhead.
- **Partitioned DML for bulk operations** — a bulk `UPDATE`/`DELETE` via
  normal DML runs as one transaction and can hit Spanner's mutation/size
  limits or hold locks too long. `PARTITIONED UPDATE`/`PARTITIONED DELETE`
  splits it into independent partitions, each its own transaction,
  trading atomicity for the ability to complete at all on a large table.
  Never use it for anything requiring all-or-nothing semantics.
- **Stale reads for latency** — see database-reviewer's note on bounded/
  exact staleness; if the read path tolerates slightly old data, this is
  usually the single biggest available latency win since it skips the
  Paxos consensus round-trip.
- **Hotspot diagnosis** — a small number of splits absorbing
  disproportionate load (elevated latency concentrated on a key range,
  conceptually what Key Visualizer surfaces) points back at PK design: a
  monotonic key or low-cardinality leading column. Re-diagnose the key
  shape (see database-reviewer's PK-hotspotting note) rather than tuning
  around it with more compute.

## Migration safety judgment

- **Expand/contract, not one-shot rewrite.** Sequence schema changes as
  (1) additive change deployed and released — new column/table/index —
  with the old shape still in use, (2) backfill existing data in bounded
  batches with a brief pause between them so it doesn't compete with
  production traffic, (3) cut the application over to the new shape, (4)
  only once nothing reads the old shape, contract — drop the old
  column/constraint in a separate, later migration. Collapsing these steps
  is what turns a routine migration into an incident.
- **Never rewrite a large table under a lock that blocks reads/writes.**
  Plain `CREATE INDEX`, `ALTER TABLE ... ADD CONSTRAINT` with validation,
  and `VACUUM FULL` all take exclusive-ish locks for the duration on
  Postgres. Use `CREATE INDEX CONCURRENTLY` and `ALTER TABLE ... ADD
  CONSTRAINT ... NOT VALID` followed by `VALIDATE CONSTRAINT` (a separate,
  lighter-locking step) instead.
- **CONCURRENTLY's failure mode.** `CREATE INDEX CONCURRENTLY` can fail
  partway through and leave an `INVALID` index behind — it does not roll
  back cleanly like a normal DDL statement inside a transaction (it can't
  run inside one at all). Always check `pg_index.indisvalid` after a
  concurrent build, and `DROP INDEX` and retry rather than assuming
  success. Same caution applies to `ALTER TABLE ... DETACH PARTITION
  CONCURRENTLY`.
- Adding a column with a volatile or non-null default historically forced
  a full table rewrite under lock; on modern Postgres (11+) a constant
  default is fast (metadata-only), but a non-constant default
  (`DEFAULT now()`, `DEFAULT gen_random_uuid()`) still rewrites the table
  — treat those as a backfill-first case, not a plain `ADD COLUMN`.
