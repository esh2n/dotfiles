# SQL review standard (PostgreSQL, Cloud Spanner)

Read by the model writing SQL, schemas or migrations, and by `code-reviewer` on any `.sql` file, migration, or SQL embedded in application code. Judgment behind plans, index shape and migration sequencing is in `../SKILL.md`; this file is the checklist. Engines in scope: PostgreSQL 13–18 and Cloud Spanner (GoogleSQL and PostgreSQL dialects). For any other engine, say the item does not transfer.

## 1. Sources

All URLs opened 2026-10-19.

| Source | URL | Covers | Freshness / version | Licence |
| --- | --- | --- | --- | --- |
| PostgreSQL docs: transaction isolation | https://www.postgresql.org/docs/current/transaction-iso.html | levels, anomalies, 40001 | PG 18.6 | PostgreSQL Licence |
| PostgreSQL docs: serialization failure handling | https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html | which SQLSTATEs to retry, retry the whole transaction | PG 18 | PostgreSQL Licence |
| PostgreSQL docs: explicit locking | https://www.postgresql.org/docs/current/explicit-locking.html | table and row lock modes, deadlocks, advisory locks | PG 18 | PostgreSQL Licence |
| PostgreSQL docs: ALTER TABLE | https://www.postgresql.org/docs/current/sql-altertable.html | rewrites, NOT VALID, VALIDATE, FK lock, DETACH CONCURRENTLY | PG 18 | PostgreSQL Licence |
| PostgreSQL docs: CREATE INDEX | https://www.postgresql.org/docs/current/sql-createindex.html | CONCURRENTLY, INVALID index, partial, INCLUDE, partitioned | PG 18 | PostgreSQL Licence |
| PostgreSQL docs: multicolumn indexes | https://www.postgresql.org/docs/current/indexes-multicolumn.html | column order, skip scan | PG 18 | PostgreSQL Licence |
| PostgreSQL docs: using EXPLAIN | https://www.postgresql.org/docs/current/using-explain.html | ANALYZE executes the statement, BUFFERS | PG 18 | PostgreSQL Licence |
| PostgreSQL docs: SELECT (locking clause) | https://www.postgresql.org/docs/current/sql-select.html | FOR UPDATE, SKIP LOCKED, NOWAIT, OFFSET locking | PG 18 | PostgreSQL Licence |
| PostgreSQL docs: INSERT | https://www.postgresql.org/docs/current/sql-insert.html | ON CONFLICT atomicity | PG 18 | PostgreSQL Licence |
| PostgreSQL docs: LIMIT and OFFSET | https://www.postgresql.org/docs/current/queries-limit.html | OFFSET cost, ORDER BY with LIMIT | PG 18 | PostgreSQL Licence |
| PostgreSQL docs: constraints | https://www.postgresql.org/docs/current/ddl-constraints.html | FK indexing, unique and NULL, ON DELETE | PG 18 | PostgreSQL Licence |
| PostgreSQL docs: comparison operators | https://www.postgresql.org/docs/current/functions-comparison.html | `= NULL`, IS DISTINCT FROM | PG 18 | PostgreSQL Licence |
| PostgreSQL docs: client connection defaults | https://www.postgresql.org/docs/current/runtime-config-client.html | statement/lock/idle/transaction timeouts | PG 18 | PostgreSQL Licence |
| PostgreSQL docs: row security | https://www.postgresql.org/docs/current/ddl-rowsecurity.html | RLS semantics, bypass, FORCE | PG 18 | PostgreSQL Licence |
| PostgreSQL docs: schemas | https://www.postgresql.org/docs/current/ddl-schemas.html | secure schema pattern, public CREATE | PG 18 | PostgreSQL Licence |
| PostgreSQL docs: JSON types | https://www.postgresql.org/docs/current/datatype-json.html | jsonb vs json, GIN opclasses | PG 18 | PostgreSQL Licence |
| PostgreSQL docs: pg_trgm | https://www.postgresql.org/docs/current/pgtrgm.html | indexes for `LIKE '%x%'` | PG 18 | PostgreSQL Licence |
| PostgreSQL release notes 14, 15, 16, 17, 18 | https://www.postgresql.org/docs/release/ (each major: `/docs/<N>/release-<N>.html`) | version-gated features | latest 18.6; 19 is RC only | PostgreSQL Licence |
| PostgreSQL wiki: Don't Do This | https://wiki.postgresql.org/wiki/Don%27t_Do_This | type and construct anti-patterns | live wiki | not checked |
| Use The Index, Luke (Markus Winand) | https://use-the-index-luke.com/ | sargability, paging, join and index cost (link only) | live site | all rights reserved; link only, never copy |
| Spanner: schema design best practices | https://docs.cloud.google.com/spanner/docs/schema-design | hotspots, key design, interleaving | live docs | Google docs terms (not checked) |
| Spanner: primary key default values | https://docs.cloud.google.com/spanner/docs/primary-key-default-value | UUID, bit-reversed sequence, IDENTITY | live docs | Google docs terms (not checked) |
| Spanner: transactions | https://docs.cloud.google.com/spanner/docs/transactions | types, aborts, retries, side effects | live docs | Google docs terms (not checked) |
| Spanner: isolation levels | https://docs.cloud.google.com/spanner/docs/isolation-levels | serializable vs repeatable read, write skew | live docs; RR GA 2026-04-17 | Google docs terms (not checked) |
| Spanner: timestamp bounds | https://docs.cloud.google.com/spanner/docs/timestamp-bounds | strong, bounded, exact staleness | live docs | Google docs terms (not checked) |
| Spanner: secondary indexes | https://docs.cloud.google.com/spanner/docs/secondary-indexes | STORING, write cost, interleaved indexes, FORCE_INDEX | live docs | Google docs terms (not checked) |
| Spanner: SQL best practices | https://docs.cloud.google.com/spanner/docs/sql-best-practices | parameters, large reads in RW txns, STARTS_WITH | live docs | Google docs terms (not checked) |
| Spanner: DML best practices | https://docs.cloud.google.com/spanner/docs/dml-best-practices | DML vs mutations, PK-scoped WHERE, batch DML | live docs | Google docs terms (not checked) |
| Spanner: partitioned DML | https://docs.cloud.google.com/spanner/docs/dml-partitioned | idempotent, non-atomic bulk DML | live docs | Google docs terms (not checked) |
| Spanner: commit timestamps | https://docs.cloud.google.com/spanner/docs/commit-timestamp | allow_commit_timestamp, key hotspot | live docs | Google docs terms (not checked) |
| Spanner: schema updates | https://docs.cloud.google.com/spanner/docs/schema-updates | validation and backfill as long-running ops | live docs | Google docs terms (not checked) |
| Spanner: quotas and limits | https://docs.cloud.google.com/spanner/quotas | 80,000 mutations / 100 MiB per commit, interleave depth 7 | live docs | Google docs terms (not checked) |
| Spanner: fine-grained access control | https://docs.cloud.google.com/spanner/docs/fgac-about | database roles, column privileges | live docs | Google docs terms (not checked) |
| Spanner release notes | https://docs.cloud.google.com/spanner/docs/release-notes | feature dates | live docs | Google docs terms (not checked) |
| Google AIP-158 Pagination | https://google.aip.dev/158 | page_token contract | live | not checked |
| OWASP SQL Injection Prevention Cheat Sheet | https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html | parameters, identifier allow-lists, least privilege | live | CC BY-SA 4.0 |
| Supabase: Row Level Security | https://supabase.com/docs/guides/database/postgres/row-level-security | RLS performance (index policy columns, `(select auth.uid())`, `TO` role) | live | not stated on page |
| Rails guides: Active Record querying | https://guides.rubyonrails.org/active_record_querying.html | N+1 and eager loading, strict_loading | live | not checked |
| squawk (Postgres migration linter) | https://squawkhq.com/docs/rules , https://github.com/sbdchd/squawk | 78 migration rules | v2.70.0, 2026-10-15 | Apache-2.0 / MIT |
| SQLFluff | https://docs.sqlfluff.com/en/stable/reference/rules.html | style and ambiguity rules; postgres dialect | 4.4.0, 2026-10-02 | MIT |

## 2. Mindset

- Read the schema first: column types, PK, every existing index, from the migration history. A missing-index or type finding without the cited migration is not a finding.
- Find the engine and version (migration tool, driver, image) before naming a feature or a lock behaviour. PostgreSQL rules do not carry to Spanner, and the reverse.
- Judge cost by table size, selectivity, and frequency. A sequential scan of a small or bounded table is the right plan.
- Treat NULL as unknown: every `=`, `<>`, `NOT IN` and unique constraint on a nullable column has a NULL case to check.
- Every read-modify-write is a concurrency question: name the isolation level and what happens when two run at once.
- A migration runs against live traffic: ask what lock it takes, for how long, and how it is undone.
- Never execute reviewed SQL. Plain `EXPLAIN` only; `EXPLAIN ANALYZE` runs the statement and its side effects, and needs explicit opt-in (`JIG_REVIEW_EXEC=1`) and a disposable database.
- Mark performance claims made without a plan on representative data as unverified, and name the `EXPLAIN` a human should run.

## 3. Habits carried from other languages

| Habit | Instead | Source |
| --- | --- | --- |
| `x NOT IN (subquery)` read as "x is absent" | `NOT EXISTS`; one NULL in the subquery makes `NOT IN` return no rows | https://wiki.postgresql.org/wiki/Don%27t_Do_This |
| `col = NULL` / `col <> $1` with a nullable param, as in `==` | `IS NULL`, `IS [NOT] DISTINCT FROM` | https://www.postgresql.org/docs/current/functions-comparison.html |
| Inclusive range `BETWEEN a AND b` on timestamps | `>= a AND < b` | https://wiki.postgresql.org/wiki/Don%27t_Do_This |
| Auto-increment / time-ordered IDs (serial, UUIDv1/v7, timestamp) as Spanner leading key | UUIDv4, bit-reversed sequence or IDENTITY, shard prefix, or a high-cardinality column first | https://docs.cloud.google.com/spanner/docs/schema-design |
| `serial` from older Postgres tutorials | identity columns | https://wiki.postgresql.org/wiki/Don%27t_Do_This |
| Lazy-loaded ORM association in a loop (N+1) | eager load / one joined or `IN` query; enable strict loading where the ORM has it | https://guides.rubyonrails.org/active_record_querying.html |
| Check-then-insert (`SELECT` then `INSERT` if missing) | `INSERT ... ON CONFLICT`, a unique constraint, or a retried serializable txn | https://www.postgresql.org/docs/current/sql-insert.html |
| Retrying only the failed statement, as with an HTTP call | retry the whole transaction including the logic that chose the SQL | https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html |
| Calling an API / publishing a message inside a DB transaction | do external I/O after commit (outbox if it must be atomic); Spanner may rerun the body | https://docs.cloud.google.com/spanner/docs/transactions |
| String-building SQL (`"... WHERE id=" + id`, f-strings) | bind parameters; allow-list identifiers and sort direction | https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html |
| `varchar(255)` / `char(n)` from MySQL habits | `text` with a `CHECK` if a limit is a real rule | https://wiki.postgresql.org/wiki/Don%27t_Do_This |
| Local-time `timestamp` | `timestamptz` | https://wiki.postgresql.org/wiki/Don%27t_Do_This |
| `LIMIT`/`OFFSET` paging without `ORDER BY` | `ORDER BY` a unique key; keyset paging at depth | https://www.postgresql.org/docs/current/queries-limit.html |

## 4. Review items

Format: `id` — trigger in the diff — what to check — why — source.

### Correctness and NULL semantics

- `sql-not-in-null` — `NOT IN (SELECT ...)` — subquery column nullable? Use `NOT EXISTS`. — returns zero rows on one NULL. — https://wiki.postgresql.org/wiki/Don%27t_Do_This
- `sql-eq-null` — `= NULL`, `<> NULL`, or `= $1` where `$1` may be NULL — use `IS NULL` / `IS NOT DISTINCT FROM`. — comparison yields NULL, row silently filtered. — https://www.postgresql.org/docs/current/functions-comparison.html
- `sql-between-timestamp` — `BETWEEN` on timestamp/date ranges — half-open `>= / <`. — upper-bound rows counted twice across adjacent ranges. — https://wiki.postgresql.org/wiki/Don%27t_Do_This
- `sql-unique-null` — `UNIQUE` on a nullable column meant to allow one value — `NULLS NOT DISTINCT` (PG 15+) or `NOT NULL`. — NULLs are distinct by default, duplicates pass. — https://www.postgresql.org/docs/current/ddl-constraints.html
- `sql-limit-no-order` — `LIMIT`/`OFFSET` without `ORDER BY` on a unique key — add a deterministic order. — unpredictable subset, pages overlap. — https://www.postgresql.org/docs/current/queries-limit.html
- `sql-timestamp-tz` — new `timestamp` (without time zone), `timetz`, `CURRENT_TIME`, `timestamp(0)` — `timestamptz`, `date_trunc`. — cannot represent an instant; precision 0 rounds into the future. — https://wiki.postgresql.org/wiki/Don%27t_Do_This
- `sql-money-type` — `money` column — `numeric`. — locale-dependent, no currency. — https://wiki.postgresql.org/wiki/Don%27t_Do_This
- `sql-fk-on-delete` — new FK without an explicit `ON DELETE` — confirm the intended action (NO ACTION default vs CASCADE/RESTRICT/SET NULL). — default blocks parent delete at runtime. — https://www.postgresql.org/docs/current/ddl-constraints.html

### Schema and keys

- `sql-identity-not-serial` — `serial`/`bigserial` in new PG DDL — `GENERATED ... AS IDENTITY`. — serial's ownership/permission quirks. — https://wiki.postgresql.org/wiki/Don%27t_Do_This
- `sql-bigint-ids` — `int`/`integer` PK or FK on a growing table — `bigint`. — squawk `prefer-bigint-over-int`; changing the type later rewrites the table. — https://squawkhq.com/docs/rules
- `sql-text-not-varchar` — `varchar(n)` / `char(n)` with arbitrary `n` — `text` plus `CHECK` when the limit is a rule. — arbitrary limits fail in production; no speed gain. — https://wiki.postgresql.org/wiki/Don%27t_Do_This
- `sql-lowercase-identifiers` — quoted mixed-case identifiers — `lower_snake_case`. — unquoted names fold to lower case. — https://wiki.postgresql.org/wiki/Don%27t_Do_This
- `sql-constraints-present` — new table/column — PK, `NOT NULL`, FK, `CHECK` where the domain rule exists. — the database is the last enforcer of invariants. — https://www.postgresql.org/docs/current/ddl-constraints.html
- `sql-jsonb-not-json` — new `json` column, or a JSON key filtered in hot queries — `jsonb`; promote hot keys to columns or index them. — `json` reparses on every use and cannot be GIN-indexed. — https://www.postgresql.org/docs/current/datatype-json.html
- `sql-no-rules-inheritance` — `CREATE RULE`, table inheritance — triggers; declarative partitioning / FKs. — rules rewrite queries unexpectedly. — https://wiki.postgresql.org/wiki/Don%27t_Do_This

### Indexes and query cost

- `sql-fk-index` — new FK — index on the referencing columns unless the parent is never deleted/re-keyed. — parent delete/update scans the child table. — https://www.postgresql.org/docs/current/ddl-constraints.html
- `sql-composite-order` — new multi-column index or a query relying on one — equality columns first, then the range column, then the sort column; more than 3 columns is rarely useful. — only leading equality plus the first range bound the scan. — https://www.postgresql.org/docs/current/indexes-multicolumn.html
- `sql-sargable` — function or cast on an indexed column in `WHERE`/`JOIN` (`lower(col)`, `date(col)`, `col::text`), or a type mismatch between compared columns — rewrite to a bare column or add a matching expression index. Cite the column types checked. — the plain B-tree is unusable. — https://use-the-index-luke.com/
- `sql-leading-wildcard` — `LIKE '%x%'` / `ILIKE` on a large table — `pg_trgm` GIN/GiST or full-text search; on Spanner, `STARTS_WITH` for prefixes. — B-tree needs a left-anchored pattern. — https://www.postgresql.org/docs/current/pgtrgm.html , https://docs.cloud.google.com/spanner/docs/sql-best-practices
- `sql-partial-index` — index over a column where queries always add a stable predicate (`deleted_at IS NULL`, `status = 'pending'`) — partial index. — smaller, cheaper to maintain. — https://www.postgresql.org/docs/current/sql-createindex.html
- `sql-covering-index` — hot query one column away from index-only — `INCLUDE (col)` (PG) / `STORING` (Spanner); state the write and size cost. — avoids heap/base-table fetch. — https://www.postgresql.org/docs/current/sql-createindex.html , https://docs.cloud.google.com/spanner/docs/secondary-indexes
- `sql-redundant-index` — new index whose columns are a prefix of an existing one, or no query in the diff uses it — ask which query it serves. — every index costs every write. — https://www.postgresql.org/docs/current/indexes-multicolumn.html
- `sql-jsonb-gin` — containment (`@>`) / jsonpath queries on jsonb — GIN, `jsonb_path_ops` when key-exists operators are not needed. — smaller, more selective index. — https://www.postgresql.org/docs/current/datatype-json.html
- `sql-n-plus-one` — query inside a loop, a repository call per item, lazy association access in a template — one join / `IN` / `= ANY($1)` / eager load. — n round trips. — https://guides.rubyonrails.org/active_record_querying.html
- `sql-offset-deep` — `OFFSET` on an unbounded or user-scrolled list — keyset paging on `(sort_key, unique_id)`; for APIs, an opaque `page_token` that encodes the position. — skipped rows are still computed. — https://www.postgresql.org/docs/current/queries-limit.html , https://google.aip.dev/158
- `sql-page-contract` — new list endpoint — finite default page size, opaque token, same params required with the token, auth checked on every page; pagination present from v1. — adding it later is breaking. — https://google.aip.dev/158
- `sql-unbounded-result` — query whose row count grows with the table and has no `LIMIT`, materialized by the client — add paging or a bound. — memory and latency grow with data. — https://www.postgresql.org/docs/current/queries-limit.html
- `sql-select-star-hot` — `SELECT *` on a wide table in a hot path (not migrations, scripts, tests) — list the columns used. — defeats index-only scans, widens the payload; SQLFluff AM04. — https://docs.sqlfluff.com/en/stable/reference/rules/ambiguous.html
- `sql-explain-safety` — PR or script running `EXPLAIN ANALYZE` on DML — wrap in `BEGIN ... ROLLBACK`, never against production. — ANALYZE executes the statement. — https://www.postgresql.org/docs/current/using-explain.html

### Transactions, isolation and locking

- `sql-check-then-act` — `SELECT` existence/balance/count, then `INSERT`/`UPDATE` on that result, at Read Committed — use a constraint, `ON CONFLICT`, `SELECT ... FOR UPDATE`, an atomic `UPDATE ... WHERE`, or Serializable with retries. — two concurrent runs both pass the check. — https://www.postgresql.org/docs/current/transaction-iso.html , https://www.postgresql.org/docs/current/sql-insert.html
- `sql-retry-serialization` — code at Repeatable Read/Serializable (PG) or any Spanner RW txn — retry loop around the whole transaction on SQLSTATE 40001 (and 40P01); Spanner client `runTransaction`-style helpers. — these levels fail instead of blocking; PostgreSQL never retries, Spanner client libraries rerun the function. — https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html , https://docs.cloud.google.com/spanner/docs/transactions
- `sql-retry-idempotent-body` — side effects (HTTP, queue publish, email, counters in memory) inside a retried transaction function — move after commit or make idempotent. — Spanner and PG retries rerun the body. — https://docs.cloud.google.com/spanner/docs/transactions
- `sql-external-io-in-txn` — network call, sleep, or user wait between `BEGIN` and `COMMIT` — move it outside. — locks held for the whole wait; idle txns block vacuum. — https://www.postgresql.org/docs/current/explicit-locking.html , https://www.postgresql.org/docs/current/runtime-config-client.html
- `sql-lock-order` — two code paths locking the same rows/tables in different orders — consistent order (e.g. `ORDER BY id FOR UPDATE`). — deadlock. — https://www.postgresql.org/docs/current/explicit-locking.html
- `sql-for-update-scope` — `FOR UPDATE` over a range or without a usable index; `FOR UPDATE` with `OFFSET` — narrow the predicate; note skipped `OFFSET` rows are locked too. — locks far more rows than returned. — https://www.postgresql.org/docs/current/sql-select.html
- `sql-skip-locked-queue` — job/queue table polled by several workers — `FOR UPDATE SKIP LOCKED`; never `SKIP LOCKED` for general reads. — workers stop queueing behind one row; the view is inconsistent by design. — https://www.postgresql.org/docs/current/sql-select.html
- `sql-advisory-lock` — advisory lock with `LIMIT` in the same query, or session-level lock without a matching unlock — apply `LIMIT` in a subquery; prefer transaction-level locks. — locks taken on rows the limit discards; session locks leak. — https://www.postgresql.org/docs/current/explicit-locking.html
- `sql-timeouts` — new role, pool or migration setup — `lock_timeout` and `statement_timeout` per role/session (not `postgresql.conf`), `idle_in_transaction_session_timeout`; `transaction_timeout` on PG 17+. — bound lock waits and idle locks. — https://www.postgresql.org/docs/current/runtime-config-client.html

### Migrations

- `sql-expand-contract` — a migration that renames/drops/retypes a column the running app still reads — expand (add new), deploy readers/writers of both, backfill, switch, contract in a later migration; say how each step is undone. — old app versions break during rollout; squawk `renaming-column`, `ban-drop-column`. — https://squawkhq.com/docs/rules
- `sql-index-concurrently` — `CREATE INDEX` / `DROP INDEX` / `REINDEX` on an existing large table — `CONCURRENTLY`, outside a transaction block; check for and drop an `INVALID` index on failure; on partitioned tables build per partition then attach. — plain `CREATE INDEX` takes `SHARE`, blocking writes. — https://www.postgresql.org/docs/current/sql-createindex.html
- `sql-constraint-not-valid` — `ADD CONSTRAINT ... FOREIGN KEY/CHECK` on a populated table — `NOT VALID`, then `VALIDATE CONSTRAINT` in a separate step (`SHARE UPDATE EXCLUSIVE`). — validation scan under a write-blocking lock otherwise. — https://www.postgresql.org/docs/current/sql-altertable.html
- `sql-set-not-null` — `SET NOT NULL` on a populated column — add a valid `CHECK (col IS NOT NULL)` first (or PG 18 `NOT NULL ... NOT VALID` then `VALIDATE`), then `SET NOT NULL`. — avoids a full scan under `ACCESS EXCLUSIVE`. — https://www.postgresql.org/docs/current/sql-altertable.html
- `sql-add-column-rewrite` — `ADD COLUMN` with a volatile default (`clock_timestamp()`, `gen_random_uuid()`), a stored generated or identity column, or a constrained domain — add nullable, backfill, then set default/constraint. — rewrites the table and its indexes. — https://www.postgresql.org/docs/current/sql-altertable.html
- `sql-alter-type-rewrite` — `ALTER COLUMN ... TYPE` — binary-coercible change? Otherwise treat as expand/contract. — full rewrite, up to double disk. — https://www.postgresql.org/docs/current/sql-altertable.html
- `sql-lock-timeout-in-migration` — DDL needing `ACCESS EXCLUSIVE` (most `ALTER TABLE`) — `SET lock_timeout` in the migration and retry. — `ACCESS EXCLUSIVE` blocks even plain `SELECT`; bound the wait and retry instead. — https://www.postgresql.org/docs/current/explicit-locking.html , https://squawkhq.com/docs/rules
- `sql-backfill-batches` — one `UPDATE`/`DELETE` over a whole large table, or a backfill inside the schema migration's transaction — keyed batches with bounded size, outside the DDL transaction; on Spanner, partitioned DML (idempotent only) or batches under the commit limit. — row locks on every touched row are held until commit; Spanner rejects commits over the mutation limit. — https://www.postgresql.org/docs/current/explicit-locking.html , https://docs.cloud.google.com/spanner/docs/dml-partitioned , https://docs.cloud.google.com/spanner/quotas
- `sql-detach-concurrently` — `DETACH PARTITION` on a live table — `CONCURRENTLY` (PG 14+), outside a transaction, no default partition. — avoids `ACCESS EXCLUSIVE` on the parent. — https://www.postgresql.org/docs/current/sql-altertable.html

### Spanner-specific

- `sql-spanner-key-hotspot` — PK or leading index column that is monotonic (sequence, timestamp, commit timestamp, UUIDv1/v7) — UUIDv4 (`NEW_UUID()`/`gen_random_uuid()`), bit-reversed sequence / `IDENTITY (BIT_REVERSED_POSITIVE)`, shard prefix, or swap key order. — all inserts land on one split. — https://docs.cloud.google.com/spanner/docs/schema-design , https://docs.cloud.google.com/spanner/docs/primary-key-default-value
- `sql-spanner-index-hotspot` — global secondary index on a monotonic column — interleaved index, or shard the index key. — the index is a table and hotspots the same way. — https://docs.cloud.google.com/spanner/docs/schema-design , https://docs.cloud.google.com/spanner/docs/commit-timestamp
- `sql-spanner-interleave` — child table always read with its parent — `INTERLEAVE IN PARENT`, join on the PK prefix; not when the child is queried independently or one parent gets very high write rates; depth ≤ 7. — co-located reads and local writes. — https://docs.cloud.google.com/spanner/docs/schema-design , https://docs.cloud.google.com/spanner/quotas
- `sql-spanner-index-cost` — new secondary index or wide `STORING` — justify by a query; global index writes are distributed. — extra write latency per mutation. — https://docs.cloud.google.com/spanner/docs/secondary-indexes
- `sql-spanner-force-index` — business-critical query relying on optimizer index choice, or a read API call — `FORCE_INDEX` (read API must name the index). — stable plans. — https://docs.cloud.google.com/spanner/docs/secondary-indexes
- `sql-spanner-commit-limit` — loop accumulating mutations into one commit, large batch writes — chunk under 80,000 mutations (columns × rows, plus index entries) and 100 MiB. — commit rejected. — https://docs.cloud.google.com/spanner/quotas
- `sql-spanner-dml-vs-mutation` — DML and mutations mixed in one txn, or a read after a mutation in the same txn — pick one; mutations are invisible until commit; use mutations for blind writes, DML for conditional writes. — read-your-writes surprises. — https://docs.cloud.google.com/spanner/docs/dml-best-practices
- `sql-spanner-partitioned-dml` — `PARTITIONED UPDATE/DELETE` — statement idempotent, single-table, no all-or-nothing need. — partitions may rerun; partial completion on error. — https://docs.cloud.google.com/spanner/docs/dml-partitioned
- `sql-spanner-large-read-in-rw` — full scan or large join inside a read-write txn — read in a read-only txn, then verify key rows in a short RW txn. — locks reduce write throughput. — https://docs.cloud.google.com/spanner/docs/sql-best-practices
- `sql-spanner-stale-read` — read-only dashboard/analytics path on a multi-region instance using strong reads — bounded/exact staleness (≥10 s for benefit); never on read-your-writes paths. — avoids leader round trip. — https://docs.cloud.google.com/spanner/docs/timestamp-bounds
- `sql-spanner-commit-ts` — app-generated audit/version timestamps — `allow_commit_timestamp` + `PENDING_COMMIT_TIMESTAMP()` as the last statement; never as the leading key. — commit order without clock skew. — https://docs.cloud.google.com/spanner/docs/commit-timestamp
- `sql-spanner-schema-validation` — DDL adding `NOT NULL`, FK, `CHECK`, stored generated column, narrowing type, or `CREATE INDEX` on a populated table — expect a long-running validation/backfill; `NOT NULL` rejects NULL writes immediately; deploy writers first. — minutes to hours, fails the update on bad data. — https://docs.cloud.google.com/spanner/docs/schema-updates
- `sql-spanner-repeatable-read` — txn set to repeatable read — guard invariants across rows with `FOR UPDATE`. — write skew possible. — https://docs.cloud.google.com/spanner/docs/isolation-levels

### Security

- `sql-injection` — SQL built by concatenation/interpolation, `format()`/`EXECUTE` with user input, raw ORM fragments — bind parameters; allow-list identifiers and `ASC`/`DESC`; in PL/pgSQL use `format('%I')`/`USING`. — injection. — https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
- `sql-least-privilege` — `GRANT ALL`, app connecting as owner/superuser, new role — only needed privileges; separate migration role from app role; Spanner FGAC database roles with column grants. — limits blast radius. — https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html , https://docs.cloud.google.com/spanner/docs/fgac-about
- `sql-public-schema` — database created before PG 15 or upgraded — `REVOKE CREATE ON SCHEMA public FROM PUBLIC`. — any user can plant objects otherwise. — https://www.postgresql.org/docs/current/ddl-schemas.html
- `sql-rls-enabled` — multi-tenant table where RLS is the isolation mechanism — `ENABLE` and `FORCE ROW LEVEL SECURITY` if the app role owns the table; `WITH CHECK` on write policies; app role not `BYPASSRLS`. — owners and BYPASSRLS skip policies; FK/unique checks bypass RLS. — https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- `sql-rls-performance` — RLS policy calling a function per row or filtering an unindexed column (Supabase) — index policy columns, wrap stable calls as `(select auth.uid())`, name the role with `TO`. — per-row evaluation. — https://supabase.com/docs/guides/database/postgres/row-level-security
- `sql-trust-auth` — `pg_hba.conf` `trust` on `host` lines, MD5 passwords — `scram-sha-256` (MD5 deprecated in PG 18). — any client can claim any user. — https://wiki.postgresql.org/wiki/Don%27t_Do_This , https://www.postgresql.org/docs/18/release-18.html

## 5. Version-gated modern features

Suggest only when the project's version (from the image, managed-service config, or migration tool) is at least the listed one. PostgreSQL 19 is a release candidate (2026-10-15); do not suggest its features yet.

| Since | Feature | Suggest when |
| --- | --- | --- |
| PG 14 | `DETACH PARTITION ... CONCURRENTLY` / `FINALIZE` | detaching from a live partitioned table |
| PG 14 | `idle_session_timeout`; `pg_read_all_data` / `pg_write_all_data` roles | read-only reporting roles instead of per-table grants |
| PG 14 | multirange types; `SEARCH`/`CYCLE` in recursive CTEs; jsonb subscripting | hand-rolled cycle detection or range lists |
| PG 15 | `MERGE` | multi-branch sync of one table from another (not a replacement for `ON CONFLICT` under concurrency) |
| PG 15 | `UNIQUE NULLS NOT DISTINCT` | at most one NULL wanted |
| PG 15 | `public` schema no longer grants `CREATE` to `PUBLIC` (new DBs only) | check upgraded DBs still have it revoked |
| PG 15 | FK `ON DELETE SET NULL (col, ...)` column list | composite FK where only some columns should clear |
| PG 16 | SQL/JSON constructors, `IS JSON`; `ANY_VALUE()`; `GRANT ... WITH INHERIT` | hand-built JSON or arbitrary `MIN()` picks |
| PG 17 | `MERGE ... RETURNING`, `WHEN NOT MATCHED BY SOURCE`; `JSON_TABLE()` | sync with deletes; shredding JSON in SQL |
| PG 17 | `transaction_timeout`; `COPY ... ON_ERROR ignore`; B-tree `IN`-list speedup | bounding total txn time; tolerant bulk load |
| PG 17 | identity columns and exclusion constraints on partitioned tables | partitioned tables still on sequences or triggers |
| PG 18 | `uuidv7()` (time-ordered) and `uuidv4()` | PG-only UUID keys wanting insert locality; never for Spanner keys |
| PG 18 | virtual generated columns (default); temporal `WITHOUT OVERLAPS` / `PERIOD` constraints | derived columns without rewrite; booking/validity tables using exclusion triggers |
| PG 18 | `RETURNING old.*, new.*`; B-tree skip scan; `NOT NULL ... NOT VALID`; `NOT ENFORCED` CHECK/FK | before/after values in one statement; a second index only to serve a later column may be unnecessary |
| PG 18 | `EXPLAIN ANALYZE` includes BUFFERS by default; MD5 auth deprecated | reading plans; auth config |
| Spanner | bit-reversed sequences, `IDENTITY (BIT_REVERSED_POSITIVE)`, `AUTO_INCREMENT`/`SERIAL` aliases with `default_sequence_kind` | integer keys without hotspots |
| Spanner (2026-01-30) | `UUID` data type | UUIDv4 keys stored as `STRING`/`BYTES` |
| Spanner (2026-03-03) | GoogleSQL `INSERT ... ON CONFLICT` | read-then-insert upserts |
| Spanner (2026-04-17 GA) | repeatable read isolation | read-heavy workloads migrated from PG/MySQL, with `FOR UPDATE` on invariants |
| Spanner (2026-08-28) | secondary indexes on scalar expressions | queries filtering on a computed value |
| Spanner (2026-02-27) | `PENDING_COMMIT_TIMESTAMP()` as column default / `ON UPDATE` | audit columns set in app code |

## 6. Concurrency model

PostgreSQL (https://www.postgresql.org/docs/current/transaction-iso.html):

| Level | Dirty read | Non-repeatable read | Phantom | Serialization anomaly | On conflict |
| --- | --- | --- | --- | --- | --- |
| Read Uncommitted (= Read Committed) | no | yes | yes | yes | blocks, re-evaluates row |
| Read Committed (default) | no | yes | yes | yes | blocks, re-evaluates row |
| Repeatable Read (snapshot) | no | no | no | yes (write skew) | 40001 "concurrent update" |
| Serializable (SSI) | no | no | no | no | 40001 "read/write dependencies" |

- Read Committed: each statement sees a new snapshot, so check-then-act across statements races. Fix with constraints, `ON CONFLICT`, row locks, or a higher level.
- Repeatable Read / Serializable: the application must retry the whole transaction on 40001; also consider 40P01, and 23505/23P01 when the key was chosen from earlier reads (https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html).
- Data read in a Serializable transaction is not valid until commit succeeds. `SERIALIZABLE READ ONLY DEFERRABLE` gives an anomaly-free snapshot for reports.
- Row locks: `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE`; table locks per command in https://www.postgresql.org/docs/current/explicit-locking.html. Only `ACCESS EXCLUSIVE` blocks plain `SELECT`.

Cloud Spanner (https://docs.cloud.google.com/spanner/docs/isolation-levels , https://docs.cloud.google.com/spanner/docs/transactions):

- Serializable (default): external consistency; pessimistic locking by default, optimistic available. Contention shows as aborts (wound-wait), retried by client libraries.
- Repeatable read (GA 2026-04-17): snapshot isolation; reads take no locks; write skew possible. Protect invariants with `FOR UPDATE` or `lock_scanned_ranges=exclusive`.
- Read-only transactions and single reads: no locks; strong by default, or bounded/exact staleness (https://docs.cloud.google.com/spanner/docs/timestamp-bounds).
- Partitioned DML: per-partition atomicity only; statements must be idempotent.
- The transaction function may run more than once; keep side effects outside it.

## 7. Linter and tool mapping

Run these first and pass their output to the review; do not repeat what they report. Never claim "no issues" from a tool that did not run.

| Tool | Catches | Item ids it covers |
| --- | --- | --- |
| squawk (`squawk --pg-version=<N> migrations/*.sql`) | migration locks and safety: `require-concurrent-index-creation`, `require-concurrent-index-deletion`, `ban-concurrent-index-creation-in-transaction`, `constraint-missing-not-valid`, `adding-foreign-key-constraint`, `adding-not-nullable-field`, `adding-field-with-default`, `changing-column-type`, `renaming-column`, `ban-drop-column`, `require-lock-timeout`, `require-statement-timeout`, `require-concurrent-partition-detach`, `require-concurrent-reindex`; types: `prefer-bigint-over-int`, `prefer-identity`, `prefer-text-field`, `prefer-timestamptz`, `ban-char-field` | `sql-index-concurrently`, `sql-constraint-not-valid`, `sql-set-not-null`, `sql-add-column-rewrite`, `sql-alter-type-rewrite`, `sql-lock-timeout-in-migration`, `sql-detach-concurrently`, `sql-expand-contract` (partly), `sql-bigint-ids`, `sql-identity-not-serial`, `sql-text-not-varchar`, `sql-timestamp-tz` |
| SQLFluff (`sqlfluff lint --dialect postgres`) | style and ambiguity: AM04 `ambiguous.column_count` (`SELECT *`), AM09 `ambiguous.order_by_limit`, CV05 `convention.is_null`, AM05/AM08 join ambiguity. No Spanner dialect. | `sql-select-star-hot` (syntax only, not whether the path is hot), `sql-limit-no-order`, `sql-eq-null` (literal `= NULL` only) |
| `EXPLAIN` (plain, no execution) | plan shape, index use, estimated rows | `sql-sargable`, `sql-composite-order`, `sql-leading-wildcard`, `sql-offset-deep` — attach as evidence, mark unverified without real statistics |
| ORM checks (e.g. Rails `strict_loading`, ORM query-count assertions in tests) | lazy loads at runtime | `sql-n-plus-one` |

Not covered by any tool, so the reviewer owns them: NULL semantics in `NOT IN` with subqueries, check-then-act and retry logic, external I/O inside transactions, expand/contract sequencing across deploys, backfill batching, every Spanner item, RLS and grants.
