# algorithmic-complexity — review checklist

Derived from ../SKILL.md. Read by `code-reviewer` and `workload-reviewer` through the `change-review` skill (defects; silences and trade-offs in a design or spec review) and by `grilling` (trade-offs). Every item points at the SKILL.md section it comes from; do not add rules that are not in SKILL.md. The per-language form of an item is in that language's `references/review-standard.md`; report the language item's id when one matches, and this one otherwise.

## defects
Objectively checkable in a diff or config. A match is a finding.

- id: cx:linear-search-in-loop
  rule: A linear search inside a loop over a collection of comparable size is quadratic.
  check: Inside a loop body, `x in list`, `includes`/`indexOf`/`contains`, `filter`/`find` over another collection, `pop(0)`/`insert(0, x)` on an array-backed list, a `sort`, or a recomputation of a loop-invariant value — where both sizes grow with data. Name the variable each size is in.
  section: "## Reading complexity in a diff"

- id: cx:string-concat-in-loop
  rule: Repeated string concatenation in a loop copies in languages with immutable strings.
  check: `s += piece` / `s = s + piece` on a string inside a loop with no builder or join, in a language that does not document an optimization for it.
  section: "## Reading complexity in a diff"

- id: cx:call-in-loop
  rule: A network or database call inside a loop is N+1.
  check: A query, HTTP call or lazy-loaded association access per item of a loop where a batch or join form exists.
  section: "## Reading complexity in a diff"

- id: cx:wrong-structure
  rule: Use a deque or hash set where the code uses a list as a queue or as a set queried in a loop.
  check: Front removal/insertion on an array-backed list used as a FIFO; repeated membership tests against a list that could be built once into a set or map.
  section: "## Choosing a data structure"

- id: cx:attacker-keyed-hash
  rule: A hash map keyed by attacker-controlled input uses a randomized, collision-resistant hash.
  check: A custom or non-seeded hasher (or a const/static map with a fixed hasher) on a map whose keys come from requests, uploaded data or other external input.
  section: "## Amortized versus worst case"

- id: cx:unbounded-loop-input
  rule: A loop whose size comes from the request or the data has a limit enforced before it.
  check: Iteration (especially nested, sort, or per-item work) over a request field, uploaded file or query result with no size cap on the path before the loop — schema maxItems, request-size limit, pagination limit or explicit check.
  section: "## Input size bounds"

- id: cx:unbounded-recursion
  rule: Recursion whose depth follows the input is bounded or converted to an explicit stack.
  check: A recursive function over external or data-sized structures (nested JSON, trees, linked chains) with no depth limit; raising the runtime's recursion limit instead of bounding depth.
  section: "## Recursion depth"

- id: cx:unbounded-memo
  rule: A memo or cache keyed by unbounded input has a size limit, TTL or request scope.
  check: `lru_cache(maxsize=None)`, `functools.cache`, or a module-level map used as a memo, keyed by external input with no eviction; a cached method keeping instances alive.
  section: "## Memoization and cache growth"

- id: cx:redos
  rule: A backtracking regex with nested or overlapping quantifiers is not applied to input the code does not control.
  check: A pattern with a repeated group containing repetition or overlapping alternation (`(a+)+`, `(.*)*`, `(a|aa)+`, `.*(?:.*=.*)`) or a trailing `\s+$`-style run, matched against external input on a backtracking engine with no length bound before matching and no match timeout.
  section: "## Regular expressions: catastrophic backtracking"

- id: cx:load-all
  rule: A result set processed item by item is paged or streamed, not loaded whole.
  check: Fetching all rows, reading an entire body or file, or collecting a full list whose size the code does not bound, followed by a single in-order pass.
  section: "## Pagination and streaming"

## silences
A design document must state these. Absence with a concrete consequence is a finding; the finding names what is unstated.

- id: cx:bound-unstated
  rule: A quadratic or worse algorithm states its input bound and which component enforces it.
  check: Nested iteration or super-linear work in the design with no stated maximum n, or a maximum stated as an expectation ("only a few") with no enforcing component on the path.
  section: "## Input size bounds"

- id: cx:cost-model-unstated
  rule: The design states whether it depends on average, amortized or worst-case cost.
  check: A latency bound on a single operation that rests on a hash lookup or growable array without saying the average is acceptable or naming how the worst case is excluded.
  section: "## Amortized versus worst case"

- id: cx:depth-unstated
  rule: A recursive algorithm states its maximum depth.
  check: Recursion in the design with no stated depth as a function of input (O(log n) for balanced, O(n) for a list or unbalanced tree).
  section: "## Recursion depth"

- id: cx:cache-shape-unstated
  rule: A cache states its key space, eviction rule and expected hit rate.
  check: A memo or cache introduced with no key space, no eviction or TTL, or no hit-rate expectation.
  section: "## Memoization and cache growth"

- id: cx:peak-memory-unstated
  rule: The design states peak memory as a function of input.
  check: A change that copies, sorts, materializes or builds an index over data-sized input, in a process with a fixed memory limit, with no stated peak.
  section: "## Space complexity"

## trade-offs
Defensible either way. Never a finding — a question with options, what each gains and loses.

- id: cx:top-k-method
  rule: Top-k by heap, full sort, or a single pass.
  options: heap / nlargest (best when k is small relative to n) | full sort (more efficient when k is large) | single min/max pass (k = 1)
  section: "## Choosing a data structure"

- id: cx:stream-or-materialize
  rule: Stream or materialize the data.
  options: stream (memory independent of input size, consumed once and forward only) | materialize (reuse, sort and index freely, peak memory grows with input — only when the size is bounded)
  section: "## Pagination and streaming"

- id: cx:optimize-what
  rule: Optimize for big-O, for constants, or not at all.
  options: fix the growth (required when n is unbounded; no benchmark needed) | tune constants such as locality and allocation (only on code measured as critical, with a benchmark) | leave it (bounded n and not measured as critical)
  section: "## Constant factors"
