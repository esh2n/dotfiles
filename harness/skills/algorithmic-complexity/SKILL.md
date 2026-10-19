---
name: algorithmic-complexity
description: Use when a change adds or changes loops over collections, nested iteration, sorting, searching, data-structure choice, string building, recursion, caching or memoization, regular expressions applied to input, pagination or bulk loading, or anything whose cost grows with input size — and when diagnosing an endpoint that slows as data grows, a job that never finishes on production volume, a CPU spike from one request, a stack overflow on deep input, or memory that grows until OOM.
metadata:
  namespaces: [arch/patterns]
---

# Algorithmic Complexity

Judgment criteria for reading the cost of code in a diff: how time and memory
grow with input size, and whether that growth is safe for the sizes the code
will actually see. Language-specific items (which container, which builder,
which lint) live in each language's review standard; this skill holds the
reasoning that applies to all of them. Sources checked 2026-10-19.

## Reading complexity in a diff

The cost of a loop is the number of iterations times the cost of one
iteration. A diff hides quadratic work when the body calls something that is
itself linear in a collection the loop also grows with.

**[defect] A linear search inside a loop over a collection of comparable size
is quadratic.** The common forms:

| In the loop body | Cost per call | Why |
|---|---|---|
| `x in some_list` (Python), `list.includes` / `indexOf` (JS), `List.contains` / `indexOf` (Java) | O(n) | Python lists document O(n) membership (https://wiki.python.org/moin/TimeComplexity); Java's `ArrayList` documents every operation other than size/get/set/iterator/add as linear (https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/ArrayList.html) |
| `filter` / `find` over another collection | O(m) | a full scan per outer element; nested `filter`s multiply |
| `list.pop(0)`, `insert(0, x)` on an array-backed list | O(n) | every remaining element shifts (https://wiki.python.org/moin/TimeComplexity) |
| `sort` | O(n log n) | sorting the same data each iteration instead of once before the loop |
| a value recomputed from loop-invariant inputs | cost of the computation | the result does not change between iterations |

The fix is to build the lookup structure once before the loop — a hash set or
map keyed by what the inner search compares — or to sort once and walk both
sequences together. An `n` of 10,000 on both sides turns 10⁴ operations into
10⁸.

**[defect] Repeated string concatenation in a loop copies in languages with
immutable strings.** Python documents total runtime quadratic in the total
length for repeated `str` concatenation and recommends collecting pieces and
calling `str.join` once
(https://docs.python.org/3/faq/programming.html#what-is-the-most-efficient-way-to-concatenate-many-strings-together);
Go's `strings.Builder` exists to minimize that copying
(https://pkg.go.dev/strings#Builder). Some engines optimize particular
concatenation shapes; do not rely on an optimization the language does not
document. The per-language form is in each review standard
(`golang-patterns` `go-string-concat`, `typescript-patterns`
`ts-perf-accum-spread` for the same pattern with spread in an accumulator).

**[defect] A network or database call inside a loop is N+1.** It is the same
shape with a far larger constant: one round trip per item. The query-side
fixes are in `sql-tuning` ("## N+1 and pagination") and the language standards
(`py-perf-n-plus-1`, `ts-perf-n-plus-1`, `cs-ef-lazy`, `java-open-in-view`,
`php-lazy-guard`).

Name the variable the cost is in. "O(n²)" means nothing until `n` is tied to
something in the system: rows in a table, items in a request, users in a
tenant. A loop over a fixed enum is constant; the same loop over a table that
grows with customers is not.

## Choosing a data structure

Pick the structure from the operation the hot path performs most, using the
cost the language documents, not memory of another language.

| Operation | Choose | Documented cost |
|---|---|---|
| Membership or lookup by key | hash set / map | O(1) average in Python (https://wiki.python.org/moin/TimeComplexity), Rust `HashMap` expected O(1) (https://doc.rust-lang.org/std/collections/index.html); JS `Set` must be sublinear on average and `has` is documented faster on average than `Array.includes` at equal size (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set) |
| Ordered keys, range queries | balanced tree (`BTreeMap`, `TreeMap`) | O(log n) get/insert/remove and range (https://doc.rust-lang.org/std/collections/index.html) |
| Push/pop at both ends, FIFO queue | deque (`collections.deque`, `VecDeque`, `ArrayDeque`) | O(1) at either end in Python (https://wiki.python.org/moin/TimeComplexity); `VecDeque` is O(min(i, n−i)) for insert/remove (https://doc.rust-lang.org/std/collections/index.html) |
| Repeatedly take the smallest or largest; top-k | binary heap | Go `container/heap` documents O(log n) Push/Pop and O(n) Init (https://pkg.go.dev/container/heap) |
| Prefix and wildcard match over string keys | trie | supports prefix and wildcard matching efficiently (Sedgewick and Wayne, https://algs4.cs.princeton.edu/52trie/) |
| Dense set of small integers | bitset | packed storage, 64 bits per `long` in Java's `BitSet` (https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/BitSet.html) |

**[defect] A list used as a queue, or as a set queried in a loop, when the
language offers a deque or a hash set.** The Python standard lists this pair
directly (`py-perf-membership`).

**[trade-off] Top-k: heap, full sort, or a single pass.** Python's `heapq`
documentation says `nlargest`/`nsmallest` are best for small k, `sorted` is
more efficient for large k, and `min`/`max` for k = 1
(https://docs.python.org/3/library/heapq.html). The question is the ratio of
k to n, not which is "faster".

Rust's collection guide recommends `Vec` or `HashMap` for most cases and ranks
`Vec` faster than `VecDeque` and `VecDeque` faster than `LinkedList` for ties
(https://doc.rust-lang.org/std/collections/index.html) — a linked list is
rarely the answer even where its big-O looks better (see "## Constant factors").

## Amortized versus worst case

**[silence] State which cost the code depends on.** Many documented costs are
averages: Python marks `dict` and `set` lookups O(1) average with O(n) worst
case, and warns that an individual amortized operation can take surprisingly
long depending on the container's history
(https://wiki.python.org/moin/TimeComplexity). Rust marks dynamic-array growth
as amortized — an occasional O(n) resize spread over many operations — and
`HashMap` as expected cost that collisions can degrade
(https://doc.rust-lang.org/std/collections/index.html). For throughput the
average is the right number; for a latency bound on a single operation it is
not.

**[defect] A hash map keyed by attacker-controlled input with a non-randomized
hash.** Crafted colliding keys move every lookup to the worst case. Rust's
default `SipHash 1-3` is randomly seeded for resistance to HashDoS, and the
documentation warns that replacing the hasher can open that attack
(https://doc.rust-lang.org/std/collections/struct.HashMap.html). A faster
hasher is safe only for keys an attacker cannot choose (`rs-hasher`).

## Input size bounds

**[silence] A quadratic or worse algorithm states its bound and who enforces
it.** Quadratic is fine when `n` is small and stays small: 50 config entries,
the 7 days of a week, a page of at most 100 items. It is a finding when the
bound is only an assumption. The review question is which component
guarantees the limit — a schema `maxItems`, a request-size cap, a database
constraint, a pagination limit — and whether that component sits on the path
before the loop. "Users won't have more than a few" is not a guarantee.

**[defect] A loop whose size comes from the request or the data, with no
limit before it.** The caller or the dataset sets the cost. This is the same
check as `ts-perf-fanout` and `rs-unbounded-spawn` applied to CPU instead of
concurrency.

To estimate whether an approach fits, competitive programmers convert the
bound into an operation count and compare it with what a machine executes per
second. The USACO Guide gives 10⁸ simple operations per second as a
conservative estimate, possibly near 5·10⁸ with good constant factors, and
maps input sizes to complexities that fit — for example O(n²) up to about
7,500, O(n log n) up to about 500,000, O(n) up to about 5,000,000 — while
warning that constant factors can still exceed a tight limit
(https://usaco.guide/bronze/time-comp). These figures are for one second of
compiled code on a judge; a request handler's budget is a fraction of its
latency target, and an interpreted language's operation is slower. Use the
arithmetic to rule an approach out, not to prove it fast.

## Recursion depth

**[defect] Recursion whose depth follows the input, on input the code does not
bound.** Every runtime limits stack depth. Python caps interpreter depth with
`sys.getrecursionlimit()` to keep infinite recursion from overflowing the C
stack, and setting the limit too high can crash the interpreter
(https://docs.python.org/3/library/sys.html#sys.setrecursionlimit). Go grows
goroutine stacks up to a maximum (1 GB on 64-bit) and the program crashes when
a goroutine exceeds it (https://pkg.go.dev/runtime/debug#SetMaxStack). Deeply
nested JSON, a long linked chain, or a degenerate tree reaches these limits;
convert to an explicit stack or bound the depth before recursing.

**[silence] A recursive algorithm states its maximum depth.** Balanced
structures recurse O(log n); a naive recursive walk over a list or an
unbalanced tree recurses O(n). The design should say which.

## Memoization and cache growth

**[defect] A memo or cache keyed by unbounded input with no size limit.**
Python's `lru_cache(maxsize=None)` and `cache` never evict and grow without
bound, and a cached method keeps `self` and every argument alive until the
entry ages out (https://docs.python.org/3/library/functools.html#functools.lru_cache).
A module-level map used as a memo has the same property
(`ts-perf-unbounded-cache`). Bound it by entry count or memory, or by a TTL,
or scope it to one request.

**[silence] A cache states its key space, eviction rule and expected hit
rate.** A memo turns repeated work into memory; without the key space the
memory cost is unknown. Correctness of shared caches across processes is in
`distributed-correctness`.

## Regular expressions: catastrophic backtracking

**[defect] A backtracking regex with nested or overlapping quantifiers applied
to input the code does not control.** OWASP describes ReDoS as a regex engine
slowing down exponentially in input size on crafted input; the dangerous shape
is a repeated group containing repetition or overlapping alternation, such as
`(a+)+$`, `([a-zA-Z]+)*$` or `(a|aa)+$`
(https://community.owasp.org/attacks/Regular_expression_Denial_of_Service_-_ReDoS).
Two outages show the range. Cloudflare's 2019 outage came from a WAF rule
containing `.*(?:.*=.*)`; backtracking pushed CPU near 100% across the network
for 27 minutes, and a CPU-usage protection had been removed in an earlier
refactor (https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/).
Stack Overflow's 2016 outage came from a trim regex ending in
`[\s‌]+$` meeting about 20,000 consecutive whitespace characters — only
quadratic, about 2·10⁸ character checks, but enough to fail the home page the
load balancer used as a health check, and the fix replaced the regex with
substring code (https://stackstatus.tumblr.com/post/147710624694/outage-postmortem-july-20-2016).

The defenses, in order: bound input length before matching; use an engine with
a linear-time guarantee where the language has one — Go's `regexp` guarantees
time linear in the input (https://pkg.go.dev/regexp), and Cloudflare named
re2 and Rust's regex engine for that reason; otherwise set a match timeout and
treat a timeout as a validation failure
(https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html).
A user-supplied pattern is regex injection and goes to `security-reviewer`.
Per-language items: `pl-regex-dos`; compiling a pattern inside a loop is a
separate constant-factor item (`go-regexp-loop`, `java-pattern-hoist`).

## Pagination and streaming

**[defect] Loading a whole result set into memory when the caller processes
it item by item.** Memory then grows with the table, not with the work.
Fetch in pages, or stream. Pagination shape (keyset over offset) is in
`sql-tuning` ("## N+1 and pagination") for queries and `api-design`
("## Collections: pagination, ordering, filtering") for APIs; reading a whole
HTTP body or file whose size the code does not bound is `ts-perf-buffer-all`.

**[trade-off] Stream or materialize.** A generator or iterator computes values
on demand without materializing them all, which is what makes very large or
infinite inputs workable; the cost is that it is consumed once and moves only
forward (https://docs.python.org/3/howto/functional.html#generator-expressions-and-list-comprehensions).
Materialize when the data is reused, sorted, or indexed and its size is
bounded; stream when it is processed once in order. Collecting into a list
that is iterated once is the Rust `rs-needless-collect` item.

## Space complexity

**[silence] State the memory a change holds at peak, as a function of
input.** Time is reviewed by habit and space is not. A sort that copies, a
map built to speed up a lookup, a materialized intermediate list and a memo
all trade memory for time. The trade is usually right; the finding is when
the peak scales with an unbounded input inside a process with a fixed memory
limit. The consequence of an unbounded in-memory queue is in
`resilience-patterns`.

## Constant factors

Big-O hides the constant, and for small or bounded `n` the constant decides.
The USACO Guide notes that the same complexity can miss a time limit on
constant factors alone (https://usaco.guide/bronze/time-comp); Rust ranks
contiguous `Vec` ahead of `LinkedList` for ties (https://doc.rust-lang.org/std/collections/index.html).
Contiguous memory, fewer allocations and fewer pointer hops usually beat a
structure with better asymptotics until `n` is large. Per-language allocation
items: `rs-alloc-in-loop`, `rs-with-capacity`, and `go-performance`.

**[trade-off] Optimize for big-O, for constants, or not at all.** Knuth's
"premature optimization is the root of all evil" sits in a passage that also
says not to pass up the critical 3%, to look at critical code only after it
has been identified, and that programmers' intuitive guesses about what is
critical fail when checked with measurement tools (Knuth, "Structured
Programming with go to Statements", ACM Computing Surveys 6(4), 1974, p. 268;
scan at https://www.gwern.net/doc/cs/algorithm/1974-knuth.pdf). The quote is
an argument for measuring before tuning constants, not for ignoring an
algorithm whose growth makes the code fail at production size. An asymptotic
defect on an unbounded input is a finding without a benchmark; a
constant-factor change needs one.

## Related

- Language review standards (`skills/<lang>/references/review-standard.md`) —
  the per-language form of each item: `py-perf-membership`,
  `py-perf-n-plus-1`, `ts-perf-accum-spread`, `ts-perf-unbounded-cache`,
  `ts-perf-buffer-all`, `go-string-concat`, `go-regexp-loop`,
  `rs-needless-collect`, `rs-hasher`, `java-pattern-hoist`, `pl-regex-dos`,
  `swift-complexity-doc`.
- `sql-tuning` — query plans, N+1 and pagination on the database side.
- `go-performance`, `react-performance` — measurement loops and
  language-specific performance judgment.
- `resilience-patterns` — bounded queues and load shedding when the cost
  grows faster than capacity.
- `distributed-correctness` — caches shared across processes.
