# Go review standard

The one Go standard for both the model writing Go and `code-reviewer`
reviewing a Go diff. It lists what to check and where the rule comes from;
detail and code live in the skills it links: `golang-patterns` (structure,
errors, interfaces), `go-modern` (version-gated replacements),
`go-concurrency` (primitives, lifetimes, memory model), `go-performance`
(measurement loop, runtime knobs), `golang-testing` (test patterns).

Before applying any rule, read the module's `go` directive in `go.mod` (the
language floor) and `toolchain` if present. A rule gated on a version does
not apply below it. Confirm an API exists at that floor with
`go doc <pkg>.<Symbol>`; never from memory.

## 1. Sources

| Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|
| Go Code Review Comments (CRC) | https://go.dev/wiki/CodeReviewComments | Common review comments: errors, interfaces, receivers, contexts, goroutine lifetimes, naming | Go wiki, maintained; fetched 2026-10-19 | CC BY 4.0 (https://go.dev/copyright) |
| Go Test Comments (GTC) | https://go.dev/wiki/TestComments | Test failure messages, comparisons, `t.Error` vs `t.Fatal` | Go wiki supplement to CRC; fetched 2026-10-19 | CC BY 4.0 |
| Google Go Style Decisions (GSD) | https://google.github.io/styleguide/go/decisions | Normative decisions: naming, errors, interfaces, generics, tests | Normative, not canonical; fetched 2026-10-19 | CC BY 3.0 (google/styleguide LICENSE) |
| Google Go Best Practices (GBP) | https://google.github.io/styleguide/go/best-practices | Error wrapping and logging, global state, interfaces, size hints, channel direction, concurrency docs | Advisory; fetched 2026-10-19 | CC BY 3.0 |
| Go Memory Model (MEM) | https://go.dev/ref/mem | Happens-before, racy programs, incorrect synchronization idioms | Version of 2022-06-06 (current) | CC BY 4.0 |
| Data Race Detector (RACE) | https://go.dev/doc/articles/race_detector | What `-race` finds, overhead, typical races | Current; fetched 2026-10-19 | CC BY 4.0 |
| Go release notes 1.21–1.27 (REL) | https://go.dev/doc/go1.21 … https://go.dev/doc/go1.27 | Version-gated language, library, vet and runtime changes | 1.27 released 2026-08 (latest) | CC BY 4.0 |
| Working with Errors in Go 1.13 (ERR) | https://go.dev/blog/go1.13-errors | `%w` vs `%v`, `errors.Is`/`As` | 2019; still the reference for wrapping | CC BY 4.0 |
| When To Use Generics (GEN) | https://go.dev/blog/when-generics | Type parameters vs interfaces | 2022-04-12 | CC BY 4.0 |
| GC guide (GC) | https://go.dev/doc/gc-guide | `GOGC`, `GOMEMLIMIT`, escape analysis | Current | CC BY 4.0 |
| Standard library docs (PKG) | https://pkg.go.dev/std | API contracts (`sync`, `context`, `net/http`, `database/sql`, `log/slog`, `unsafe`) | Tracks the latest release | BSD-3-Clause (code), CC BY 4.0 (text) |
| go vet analyzers (VET) | https://pkg.go.dev/cmd/vet | 35 default analyzers | Go 1.27 | BSD-3-Clause |
| Staticcheck checks (SC) | https://staticcheck.dev/docs/checks/ | SA/S/ST/QF check catalogue | Release 2026.2 | MIT |
| golangci-lint linters (GCL) | https://golangci-lint.run/docs/linters/ | Linter catalogue | v2.15.0; page updated 2026-10-18 | GPL-3.0 (tool) |
| 100 Go Mistakes (100GO) | https://100go.co | Mistake catalogue by number (name and number cited only) | Site current; book 2022 | CC BY-NC-ND 4.0 |
| declscope decision note | `harness/rules/decisions/2026-09-30-declscope-file-scoped-private.md` | House rule: unexported names are file-private | Accepted 2026-09-30 | This repository |

Effective Go (https://go.dev/doc/effective_go) has not been revised for
modules, generics or anything after 2009-era idioms; do not cite it for
current practice.

## 2. Mindset

- Clear over clever: short functions with early returns, the error path
  indented and the happy path at the left margin (CRC#indent-error-flow).
- Errors are values returned last, checked at every call, wrapped only when
  the caller should inspect the cause (GSD#returning-errors, ERR).
- Small interfaces defined by the consumer; producers return concrete types
  (CRC#interfaces, GBP#interfaces).
- Make the zero value useful; avoid constructors that only allocate.
- Synchronous APIs by default; the caller adds concurrency. Every goroutine
  has a visible owner and exit (CRC#synchronous-functions,
  CRC#goroutine-lifetimes).
- No mutable package-level state that changes behaviour; pass dependencies
  explicitly (GBP#globals).
- Generics only when the body is identical across types (GEN, GSD#generics).
- `gofmt` output is not up for review (CRC#gofmt).

## 3. Habits carried from other languages

| Habit | Do instead | Source |
|---|---|---|
| Interface declared next to its implementation "for mocking" (Java, C#) | Declare the interface in the consuming package; return the concrete type | https://go.dev/wiki/CodeReviewComments#interfaces, 100GO #6 |
| Functions returning an interface type | Return the concrete type unless hiding it is the point | https://google.github.io/styleguide/go/best-practices#interfaces, 100GO #7 |
| One-method-per-class interface explosion / interface before a second implementation exists | Add the interface when a second implementation or consumer needs it | https://google.github.io/styleguide/go/best-practices#avoid-unnecessary-interfaces, 100GO #5 |
| `GetName()` getters (Java beans) | `Name()`; reserve `Compute`/`Fetch` for costly or remote calls | https://google.github.io/styleguide/go/decisions#getters |
| Exceptions for control flow (`panic`/`recover` as try/catch) | Return `error`; panic only on API misuse or invariant breaks | https://go.dev/wiki/CodeReviewComments#dont-panic, https://google.github.io/styleguide/go/best-practices#when-to-panic |
| Sentinel return values (`-1`, `""`, `nil` meaning "not found") as in C | Extra `ok bool` or `error` result | https://go.dev/wiki/CodeReviewComments#in-band-errors |
| `this`/`self` receiver names (Python, Java) | Short, consistent abbreviation of the type | https://go.dev/wiki/CodeReviewComments#receiver-names |
| `MAX_SIZE` / `snake_case` names | `maxSize` / `MaxSize`; initialisms keep case (`URL`, `appID`) | https://go.dev/wiki/CodeReviewComments#mixed-caps, #initialisms |
| Request-scoped context stored in a struct field (thread-local style) | Pass `ctx context.Context` as the first parameter | https://go.dev/wiki/CodeReviewComments#contexts |
| Async-by-default APIs returning futures/channels (JS, C#) | Synchronous function; caller wraps it in a goroutine | https://go.dev/wiki/CodeReviewComments#synchronous-functions |
| Assertion libraries (`assert.Equal`, JUnit style) | Plain `if` + `t.Errorf` with got/want; `cmp.Diff` for structures | https://go.dev/wiki/TestComments#assert-libraries, https://google.github.io/styleguide/go/decisions#assertion-libraries |
| `util`/`common`/`helpers` packages | Name the package for what it provides | https://go.dev/wiki/CodeReviewComments#package-names |

## 4. Review items

Format: `id` — trigger visible in a diff — what to check — why — source.
One-line items are general knowledge; detail appears only where judgment or
a threshold is involved.

### 4.1 Correctness

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| go-loopvar-floor | `v := v`, closure or goroutine capturing a loop variable | On `go` ≥ 1.22 the copy is redundant (cleanup, not a bug). On `go` < 1.22 a missing copy is a race and the copy must stay | Per-iteration semantics key off the `go` directive, not the toolchain | https://go.dev/doc/go1.22, https://go.dev/blog/loopvar-preview |
| go-use-before-err | A result used before `if err != nil` | Check `err` immediately after the call | Go 1.25 fixed a compiler bug; such code now panics as the spec requires | https://go.dev/doc/go1.25 |
| go-nil-interface | Function returning a typed nil pointer as `error` or another interface | Return a literal `nil` | A non-nil interface holding a nil pointer fails `err != nil` checks | https://google.github.io/styleguide/go/decisions#returning-errors, SC SA4023 |
| go-shadow | `:=` inside a block re-declaring `err` or a result variable | Confirm the outer variable is the one later read | Silent shadowing drops the inner assignment | 100GO #1 |
| go-copy-aliasing | Struct with slice/map/pointer fields or a `sync` type copied by value | Copy deep or pass a pointer; never copy after first use | Copies alias the backing data; a copied mutex is a separate lock | https://go.dev/wiki/CodeReviewComments#copying, https://pkg.go.dev/sync |
| go-subslice-retain | Long-lived subslice of a large buffer (`s[a:b]` stored or returned) | Copy out with `slices.Clone` or `append` when it outlives the source | Keeps the whole backing array alive | 100GO #26 |
| go-append-alias | `append` on a slice parameter or shared slice | Check whether two slices now share a backing array | Writes become visible through the other slice; under concurrency, a race | 100GO #69 |
| go-close-resource | `resp.Body`, `sql.Rows`, `os.File`, `sql.Tx` opened | Closed (or Commit/Rollback) on every path, `rows.Err()` checked after the loop | Leaks connections and file descriptors | https://pkg.go.dev/net/http, https://pkg.go.dev/database/sql, 100GO #79 |
| go-defer-loop | `defer` inside a `for` | Move the body into a function or close explicitly | Defers run at function return; resources accumulate | 100GO #35, SC SA9001 |
| go-unsafe | New `import "unsafe"` | A stated reason and a test on each supported architecture | Non-portable and outside the compatibility promise | https://pkg.go.dev/unsafe |
| go-crypto-rand | `math/rand` used for keys, tokens, IDs that must be unguessable | `crypto/rand` (`rand.Text()` since 1.24) | `math/rand` is predictable | https://go.dev/wiki/CodeReviewComments#crypto-rand, https://go.dev/doc/go1.24 |
| go-panic-nil | `recover()` result compared to `nil` to detect a panic | Since 1.21 `panic(nil)` becomes `*runtime.PanicNilError`; code relying on nil is wrong on `go` ≥ 1.21 | Behaviour changed with the `go` directive | https://go.dev/doc/go1.21 |
| go-json-strict | `encoding/json` decoding of external data on toolchain 1.27+ | Invalid UTF-8 and duplicate keys now error; decide whether to restore v1 `Options` | Data that decoded before can now fail | https://go.dev/doc/go1.27 |
| go-path-root | File path built from external input then opened | Prefer `os.OpenRoot` (1.24) to confine access; security finding goes to `security-reviewer` | `filepath.Clean` + prefix check misses symlinks | https://go.dev/doc/go1.24 |

### 4.2 Errors

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| go-err-ignored | `_ =` or a bare call discarding an `error` | Handle, return, or document why it is safe to drop (e.g. `Close` on a read-only file, with a comment) | Lost failures | https://go.dev/wiki/CodeReviewComments#handle-errors, 100GO #53 |
| go-err-defer | `defer f.Close()` on a writable file or a transaction | Capture the `Close`/`Commit` error into the named result | Write errors surface only at close | 100GO #54 |
| go-err-wrap | `fmt.Errorf` adding context | `%w` only when callers should inspect the cause; `%v` when the cause is an implementation detail. Put `%w` at the end (sentinels at the start). Add only context the inner error lacks — no "failed to" chains repeating the callee's text | Wrapping makes the inner error part of the API | https://go.dev/blog/go1.13-errors, https://google.github.io/styleguide/go/best-practices#error-percent-w, 100GO #49 |
| go-err-compare | `err == ErrX`, `err.(*T)`, `strings.Contains(err.Error(), …)` | `errors.Is` / `errors.As` / `errors.AsType` (1.26) | `==` and assertions see only the outermost error | https://go.dev/blog/go1.13-errors, https://pkg.go.dev/errors, 100GO #50, #51 |
| go-err-wrap-ptr | `fmt.Errorf("…: %w", p)` where `p` is `*E` and `E` (not `*E`) implements `error` | Pass the value | vet `printf` reports it since 1.27; `errors.As` will not match | https://go.dev/doc/go1.27 |
| go-err-string | Error text capitalised or ending in punctuation | lowercase, no trailing punctuation | It is embedded in other messages | https://go.dev/wiki/CodeReviewComments#error-strings, SC ST1005 |
| go-err-log-and-return | Same error both logged and returned | Do one; usually return and let the caller log | Duplicate log lines | https://google.github.io/styleguide/go/best-practices#error-logging |
| go-err-last | `error` not the last result | Move it last | Convention every caller assumes | https://google.github.io/styleguide/go/decisions#returning-errors, SC ST1008 |
| go-err-naming | Exported error variable not `ErrFoo`, error type not `FooError` | Rename | Discoverability | SC ST1012 |
| go-panic | `panic` on a recoverable condition, `log.Fatal` in a library | Return an error; `Must…` only for init-time constants | Callers cannot recover; library exits the process | https://google.github.io/styleguide/go/decisions#dont-panic, #must-functions, 100GO #48 |
| go-err-join | Several independent failures collected | `errors.Join` (1.20); not for a single causal chain (use `%w`) | `Join` keeps all causes inspectable | https://pkg.go.dev/errors |

### 4.3 Concurrency

Correctness rules here; primitive choice and patterns are in
`go-concurrency`. A finding needs a concrete interleaving or a hang
scenario, not "might race".

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| go-goroutine-owner | New `go` statement | Name who stops it (`ctx.Done()`, channel close, `WaitGroup`/`errgroup`) and who waits for it | A goroutine with no exit is a leak | https://go.dev/wiki/CodeReviewComments#goroutine-lifetimes, 100GO #62 |
| go-shared-write | Variable written in one goroutine and read or written in another | A happens-before edge exists (channel, lock, atomic, `WaitGroup`) | Unsynchronised access is a data race; on multiword values (interface, slice, string, map) it can corrupt memory | https://go.dev/ref/mem#restrictions, https://go.dev/doc/articles/race_detector#Typical_Data_Races |
| go-dcl | `if !done { once.Do(...) }`, `for !flag {}` busy-wait on a plain variable | Use `sync.Once`/`OnceValue`, an atomic, or a channel | The memory model gives no guarantee the write is observed | https://go.dev/ref/mem#badsync |
| go-wg-add | `wg.Add` inside the goroutine it counts, or after `go` | `Add` before `go`, or `wg.Go(f)` on 1.25+ | Races with `Wait` | https://pkg.go.dev/sync, VET `waitgroup`, SC SA2000 |
| go-chan-close | `close(ch)` in a receiver or in more than one place; send after possible close | Exactly one owner closes, after all senders finish; give parameters a direction (`<-chan`, `chan<-`) | Double close and send-on-closed panic | https://go.dev/blog/pipelines, https://google.github.io/styleguide/go/best-practices#channel-direction, https://go.dev/doc/articles/race_detector#Unsynchronized_send_and_close_operations |
| go-block-forever | Send/receive or `Lock` with no `select` on `ctx.Done()` and no timeout | Caller can cancel it | Blocked goroutines leak and hold resources | https://go.dev/blog/pipelines, https://go.dev/wiki/CodeReviewComments#goroutine-lifetimes |
| go-lock-io | Lock held across I/O, a channel operation, or a callback | Shrink the critical section; if it can deadlock it is correctness, if it only serialises work it is performance (4.4) | Deadlock or contention | https://pkg.go.dev/sync |
| go-rwmutex-recursive | `RLock` taken again while already holding a read lock | Restructure | A pending writer blocks the second `RLock`: deadlock | https://pkg.go.dev/sync |
| go-atomic-multistep | Two atomics forming one check-then-act | Use a mutex | Two atomics are two race windows | https://pkg.go.dev/sync/atomic |
| go-ctx-first | `context.Context` stored in a struct, not first parameter, or `context.Background()` inside a request path | Thread the caller's `ctx`; `context.WithoutCancel` (1.21) for cleanup that must outlive cancellation | Lost cancellation and deadlines | https://go.dev/wiki/CodeReviewComments#contexts, https://google.github.io/styleguide/go/decisions#contexts, 100GO #61 |
| go-ctx-cancel | `cancel` from `WithCancel`/`WithTimeout` not called on every path | `defer cancel()` | Leaks the context's timer and goroutine | VET `lostcancel` |
| go-ctx-value | `context.WithValue` carrying required parameters, or a built-in key type | Only request-scoped metadata, unexported key type | Hidden API; key collisions | https://pkg.go.dev/context, SC SA1029 |
| go-time-after-loop | `time.After` / `time.Tick` inside a loop or repeated `select` | One `time.NewTimer` with `Reset`, or a `context.WithTimeout`. Below `go` 1.23 the timer is held until it fires | Allocation per iteration; pre-1.23 retention | https://go.dev/wiki/Go123Timer, 100GO #76, SC SA1015 |
| go-t-fatal-goroutine | `t.Fatal`/`FailNow` in a goroutine started by a test | `t.Error` and return | Not allowed off the test goroutine | https://google.github.io/styleguide/go/best-practices#t-fatal-goroutine, VET `testinggoroutine`, SC SA2002 |
| go-select-priority | Code relying on `select` case order | Restructure; ready cases are chosen uniformly at random | Order is not a priority | https://go.dev/ref/spec#Select_statements |
| go-concurrency-test | New goroutines with no `-race` run or leak check in tests | Name `go test -race` for the package; `goleak` or `testing/synctest` (1.25) where it fits | `-race` finds only races on executed paths | https://go.dev/doc/articles/race_detector#Usage, 100GO #83, https://pkg.go.dev/testing/synctest |

### 4.4 Performance

Report only on paths that run often (request path, tight loop); say so when
the code is cold and skip it. Tag each finding `static` (holds without
measurement) or `needs-measurement`, and give the command that would
confirm it (`go test -bench=X -count=10 -benchmem`, then `benchstat`). Never
call a performance claim verified without a benchstat result and a pprof
`-diff_base` showing the targeted function shrank. Method and thresholds:
`go-performance` ("Measure First").

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| go-unbounded-goroutines | `go` per input item with no limit | `errgroup.SetLimit` or `semaphore.Weighted` | Memory and downstream saturation grow with input | https://pkg.go.dev/golang.org/x/sync/errgroup |
| go-unbounded-cache | Map or slice used as a cache with no eviction or size bound | Bound it; a map does not shrink after deletes, so rebuild after peaks | Unbounded memory growth | 100GO #28 |
| go-http-client | `http.DefaultClient`, `http.Get`, or a `Client{}` with no `Timeout` on an outbound call | Set `Client.Timeout` or per-request context deadlines; raise `MaxIdleConnsPerHost` (default 2) for high fan-out to one host | Zero timeout means none; connection churn | https://pkg.go.dev/net/http#Client, 100GO #81 |
| go-sql-pool | New `sql.DB` with no pool limits | `SetMaxOpenConns` (default 0, unlimited) sized to the database's budget | Exhausts database connections under load | https://pkg.go.dev/database/sql |
| go-string-concat | `+=` on strings in a loop | `strings.Builder` | Quadratic copying | https://google.github.io/styleguide/go/best-practices#string-concatenation, 100GO #39 |
| go-regexp-loop | `regexp.MustCompile`/`regexp.Match*` inside a function body on a hot path | Package-level compiled `*regexp.Regexp` (safe for concurrent use) | Recompiles per call | SC SA6000, https://pkg.go.dev/regexp |
| go-prealloc | `append` in a loop where the final length is known | `make([]T, 0, n)` — only when `n` is known; most code needs no size hint | Avoids regrowth; over-hinting wastes memory | https://google.github.io/styleguide/go/best-practices#size-hints, 100GO #21 |
| go-slog-eager | `slog` call with an expensive argument at a level that may be filtered | `logger.Enabled` guard or a `slog.LogValuer` | Arguments are evaluated even when the record is dropped | https://pkg.go.dev/log/slog#hdr-Performance_considerations |
| go-pool-fit | New `sync.Pool` | Large, short-lived, hot objects only; store pointers; reset on `Get` | Items may be dropped at any GC; non-pointer values allocate | https://pkg.go.dev/sync, SC SA6002 |
| go-mutex-vs-atomic | Mutex guarding a single counter or flag on a contended path | Typed atomics (`atomic.Int64`); keep the mutex for multi-field invariants. needs-measurement unless contention is shown | Lock overhead vs correctness of the invariant | https://pkg.go.dev/sync/atomic |
| go-false-sharing | Per-goroutine counters packed in one struct or array, written concurrently | Pad to separate cache lines; needs-measurement | Cache-line ping-pong | 100GO #92 |
| go-escape | Hot path returning pointers, boxing into `any`, closures that escape | Check `go build -gcflags=-m`; needs-measurement | Heap allocation and GC cost | https://go.dev/doc/gc-guide#Eliminating_heap_allocations, 100GO #95 |
| go-gc-knobs | `GOGC`/`GOMEMLIMIT`/`GOMAXPROCS` set in code, env or manifests | `GOMEMLIMIT` with 5–10 % headroom below the container limit, not where memory scales with input; do not hand-set `GOMAXPROCS` on 1.25+ (it disables the cgroup-aware default) | Thrashing; throttling | https://go.dev/doc/gc-guide, https://go.dev/doc/go1.25 |
| go-runtime-moot | Allocation-heavy or map-heavy finding | Check whether the floor already includes Swiss-table maps (1.24), Green Tea GC (1.26), faster small allocations (1.27); say so instead of a rewrite | A version bump may answer it | https://go.dev/doc/go1.24, https://go.dev/doc/go1.26, https://go.dev/doc/go1.27 |
| go-pgo | Request to optimise a CPU-bound service | Consider `default.pgo` (auto since 1.21) after algorithmic fixes | 2–7 % typical, on correct code shape | https://go.dev/doc/go1.21, https://go.dev/doc/pgo |
| go-bench-shape | New benchmark with `for i := 0; i < b.N; i++` | `for b.Loop()` on 1.24+ | Dead-code elimination and timer mistakes | https://go.dev/doc/go1.24, https://go.dev/blog/testing-b-loop |

### 4.5 API design

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| go-iface-consumer | Interface declared in the package that implements it, or with one implementation and no second consumer | Move to the consumer or delete; keep it small | Interface pollution | https://go.dev/wiki/CodeReviewComments#interfaces, https://google.github.io/styleguide/go/best-practices#interface-ownership-and-visibility |
| go-return-concrete | Exported function returning an interface | Return the concrete type unless encapsulation or a dependency cycle requires the interface | Callers lose methods and fields | https://google.github.io/styleguide/go/best-practices#interfaces |
| go-generics-fit | New type parameter | Body identical across types; behaviour that differs per type, or a body that only calls methods, is an interface. A type switch on a type parameter means the parameter buys nothing | Ceremony without benefit | https://go.dev/blog/when-generics, https://google.github.io/styleguide/go/decisions#generics |
| go-globals | New mutable package-level variable, `init()` registering behaviour | Pass an instance; default instances only as thin wrappers | Order-dependent tests, hidden coupling | https://google.github.io/styleguide/go/best-practices#globals |
| go-sync-api | Exported function returning a channel or starting work in the background | Make it synchronous unless the asynchrony is the point; document cleanup (`Stop`, `Close`) the caller owns | Callers can add concurrency; leaks otherwise | https://go.dev/wiki/CodeReviewComments#synchronous-functions, https://google.github.io/styleguide/go/best-practices#documentation-conventions-cleanup |
| go-receiver-type | Methods mixing value and pointer receivers; value receiver on a struct with a mutex | One kind per type; pointer when mutating, holding a `sync` field, or large | Copy bugs; inconsistent method sets | https://go.dev/wiki/CodeReviewComments#receiver-type |
| go-pass-values | `*string`, `*int`, `*io.Reader` parameters only to save copying | Pass the value | No saving; adds nil cases | https://go.dev/wiki/CodeReviewComments#pass-values |
| go-options | Constructor with many positional parameters or boolean flags | Option struct, or variadic options when most callers set none | Readable call sites | https://google.github.io/styleguide/go/best-practices#function-argument-lists |
| go-concurrency-doc | Exported mutating type whose concurrency safety is not obvious | Doc comment states it | Users assume only read-only operations are safe | https://google.github.io/styleguide/go/best-practices#documentation-conventions-concurrency |
| go-declscope | A Go diff in a package (house rule) | See "declscope" below | Agent-written code reaching into another file's helpers | `harness/rules/decisions/2026-09-30-declscope-file-scoped-private.md` |

**declscope.** `declscope` treats an unexported name as private to its file.
Run it when it is on `PATH`, except on a diff touching `go.mod`/`go.work`
(a raised `go` or `toolchain` line would make `go list` fetch and run another
toolchain) or cgo (the C toolchain runs with the diff's flags); in those
cases name the command instead.

1. Write a config under `$TMPDIR`, never in the repository: copy the nearest
   `.declscope.yaml` without its `baseline:` line (or start empty), then add
   `baseline: absent.yaml` (a missing baseline reads as empty; the project's
   baseline is keyed by declaration and would absorb new uses).
2. Run `GOTOOLCHAIN=local GOFLAGS=-mod=readonly declscope -config <file> <changed packages>`.
3. Keep only findings whose `used here` line is a line the diff added
   (`git diff -U0` against the review base).
4. If the project has a `.declscope.yaml`, each crossing is a finding; the
   fix is an exported entry point or `//declscope:package` when sharing is
   intended. Without one, list crossings as advisory questions, not findings.
   Never write a config or baseline into the reviewed repository.

### 4.6 Naming and readability

One line each; staticcheck ST checks catch several when enabled.

| id | Trigger | Check | Source |
|---|---|---|---|
| go-early-return | `if err == nil { … } else { return err }`, happy path nested | Handle the error first and return | https://go.dev/wiki/CodeReviewComments#indent-error-flow |
| go-naked-return | Naked `return` in a function longer than a few lines | Return values explicitly; name results only for documentation | https://go.dev/wiki/CodeReviewComments#naked-returns, #named-result-parameters |
| go-repetition | `user.UserName`, `config.ConfigLoad`, type names in variable names | Drop what the package, type or context already says | https://google.github.io/styleguide/go/decisions#repetition |
| go-var-length | Long names in tiny scopes, one-letter names far from declaration | Length scales with scope | https://go.dev/wiki/CodeReviewComments#variable-names |
| go-initialisms | `Url`, `HttpServer`, `userId` | `URL`, `HTTPServer`, `userID` | https://go.dev/wiki/CodeReviewComments#initialisms, SC ST1003 |
| go-pkg-name | Package `util`, `common`, `base`, underscores or mixed case | Short, lowercase, purpose-named | https://go.dev/wiki/CodeReviewComments#package-names |
| go-receiver-name | `self`, `this`, or inconsistent receiver names | Short consistent abbreviation | https://go.dev/wiki/CodeReviewComments#receiver-names, SC ST1006, ST1016 |
| go-empty-slice | `x := []T{}` where nil works | `var x []T`, except where JSON must encode `[]` | https://go.dev/wiki/CodeReviewComments#declaring-empty-slices |
| go-doc-comment | Exported identifier without a doc comment starting with its name | Add one | https://go.dev/wiki/CodeReviewComments#doc-comments |
| go-http-status | Literal `404`, `500` | `http.StatusNotFound` … | SC ST1013 |

### 4.7 Testing

Patterns and examples: `golang-testing`. `test-reviewer` owns whether tests
protect behaviour; these are Go-specific forms.

| id | Trigger | Check | Source |
|---|---|---|---|
| go-test-failure-msg | `t.Errorf("wrong result")` | Message names the function, input, got, then want | https://go.dev/wiki/CodeReviewComments#useful-test-failures, https://go.dev/wiki/TestComments#got-before-want |
| go-test-keep-going | `t.Fatal` after a non-setup check | `t.Error` so one run shows every failure; `t.Fatal` for setup failures | https://go.dev/wiki/TestComments#keep-going |
| go-test-compare | Field-by-field checks, `reflect.DeepEqual` | Compare full structures with `cmp.Diff`, label the direction `(-want +got)` | https://go.dev/wiki/TestComments#compare-full-structures, #equality-comparison-and-diffs |
| go-test-err-semantics | Test matching `err.Error()` text | `errors.Is`/`As`, or only whether an error occurred | https://go.dev/wiki/TestComments#test-error-semantics |
| go-test-table | Many cases with identical logic as separate functions, or a table whose rows switch behaviour on flags | Table for identical logic; split when logic diverges; rows identified by name, not index | https://google.github.io/styleguide/go/decisions#table-driven-tests |
| go-test-helper | Setup helper without `t.Helper()` | Add it (not in assert-style helpers) | https://go.dev/wiki/TestComments#mark-test-helpers |
| go-test-sleep | `time.Sleep` to wait for goroutines | `testing/synctest` (1.25) or explicit synchronisation | https://go.dev/doc/go1.25 |
| go-test-ctx | `context.Background()` in a test needing cancellation at test end | `t.Context()` (1.24) | https://go.dev/doc/go1.24 |
| go-test-pkg | Third-party assertion or BDD framework added | Plain `testing` | https://google.github.io/styleguide/go/decisions#use-package-testing |

## 5. Version-gated modern features

Suggest only when the module's `go` directive is at or above the version.
Run `go fix ./...` (1.26+) before hand edits; it applies most mechanical
rewrites. Detail, and when the old form is still right: `go-modern`.

| Version | Suggest | Old form still right when |
|---|---|---|
| 1.21 | `min`/`max`/`clear`; `slices`, `maps`, `cmp`; `log/slog`; `context.WithoutCancel`/`AfterFunc`/`WithTimeoutCause`; `sync.OnceFunc`/`OnceValue`; `toolchain` directive | Floats needing explicit NaN handling (`min`/`max`); human-facing CLI output (`slog`); libraries omit `toolchain` |
| 1.22 | Per-iteration loop variables; `for i := range n`; `math/rand/v2`; `cmp.Or`; `slices.Concat`; method and wildcard patterns in `http.ServeMux` | Module below 1.22 (keep `v := v`); `cmp.Or` with costly or side-effecting arguments |
| 1.23 | Range-over-func (`iter.Seq`); `slices.Collect`/`Sorted`, `maps.Keys` (returns an iterator); synchronous timer channels; `unique` | A producer that is genuinely concurrent stays a channel; fallible sequences need `iter.Seq2[T, error]` |
| 1.24 | `b.Loop`; `omitzero`; `os.Root`; `weak`; `runtime.AddCleanup` over `SetFinalizer`; `strings.Lines`/`SplitSeq`; `crypto/rand.Text`; `t.Context`; `tool` directives in `go.mod`; generic type aliases | Consumers relying on `omitempty` eliding empty slices |
| 1.25 | `sync.WaitGroup.Go`; `testing/synctest`; container-aware `GOMAXPROCS`; `trace.FlightRecorder` | Tests crossing real network or process boundaries (`synctest` fake clock does not apply) |
| 1.26 | `errors.AsType`; `new(expr)`; `go fix` modernizers; Green Tea GC default; `testing/cryptotest.SetGlobalRandom` (crypto functions now ignore their `rand` argument) | `errors.As` for interface targets |
| 1.27 | Generic methods; `encoding/json/v2` and `jsontext`; `uuid`; `bytes`/`strings.CutLast`; `goroutineleak` profile; `stdversion` vet under `go test` | Plain struct unmarshal stays on `encoding/json`; third-party UUID library covering features the stdlib lacks |

Do not suggest `simd`, `simd/archsimd` or `runtime/secret` (experimental,
behind `GOEXPERIMENT`) — https://go.dev/doc/go1.27.

## 6. Concurrency model

- Two plain accesses to one variable from different goroutines, at least one
  a write, with no happens-before edge, is a data race — not a timing
  question. Edges come only from: `go` statement start, channel send/receive
  and close, `Mutex`/`RWMutex` unlock→lock, `Once`, atomics, `WaitGroup`
  `Done`→`Wait` — https://go.dev/ref/mem#synchronization.
- Racy multiword values (interface, slice, string, map) can tear and corrupt
  memory — https://go.dev/ref/mem#restrictions.
- "If you must read the rest of this document to understand the behavior of
  your program, you are being too clever" — prefer channels or `sync` over
  reasoning about ordering — https://go.dev/ref/mem#advice.
- `-race` reports only races on executed paths, at 5–10× memory and 2–20×
  CPU; it is a test tool, not proof of absence —
  https://go.dev/doc/articles/race_detector#Runtime_Overheads.
- Every goroutine has an owner who knows how it ends; exactly one owner
  closes a channel — https://go.dev/wiki/CodeReviewComments#goroutine-lifetimes,
  https://go.dev/blog/pipelines.
- Choose by need: channel to hand over ownership; mutex for a multi-step
  invariant; typed atomics for one word; `sync.Map` only for write-once/read-many
  or disjoint keys — https://pkg.go.dev/sync, https://pkg.go.dev/sync/atomic.
- Correctness vs speed: if dropping the finding gives a wrong result or a
  hang, it is 4.3; if it only makes the program slower, it is 4.4.
- Decision tables, patterns (worker pool, pipeline, or-done, graceful
  shutdown) and the full pitfall list: `go-concurrency`.

## 7. Linter mapping

Run the project's own linters first (its `.golangci.yml`, `lefthook.yml` or
CI) and pass their output to the review; never report "no issues" from a
tool that did not run. Without project config, run `go vet ./...` and
`staticcheck ./...`. Both type-check without executing code, except on cgo
packages, where the C toolchain runs with the package's flags: on a diff
touching cgo, name the command instead of running it. Do not run
`go build`/`go test` (including `-race`) on code under review; name the
command for a human. Do not restate what a tool that ran already reported.

| Item | Caught by |
|---|---|
| go-copy-aliasing (locks) | vet `copylocks` |
| go-ctx-cancel | vet `lostcancel` |
| go-wg-add | vet `waitgroup` (1.25), SC SA2000 |
| go-t-fatal-goroutine | vet `testinggoroutine`, SC SA2002 |
| go-loopvar-floor (pre-1.22) | vet `loopclosure` (silent on files at 1.22+) |
| go-err-compare (`errors.As` misuse) | vet `errorsas`; golangci-lint `errorlint` for `==` and assertions |
| go-err-wrap-ptr | vet `printf` (1.27) |
| go-err-ignored | golangci-lint `errcheck` (default set) |
| go-err-string, go-err-last, go-err-naming | SC ST1005, ST1008, ST1012 |
| go-initialisms, go-receiver-name | SC ST1003, ST1006, ST1016 (ST1003/ST1016 off by default) |
| go-http-status | SC ST1013 |
| go-defer-loop | SC SA9001 (range loops only) |
| go-time-after-loop (`time.Tick`) | SC SA1015 |
| go-ctx-value (key type) | SC SA1029 |
| go-nil-interface (comparison) | SC SA4023 |
| go-pool-fit (non-pointer) | SC SA6002 |
| go-regexp-loop | SC SA6000 |
| go-close-resource | golangci-lint `bodyclose`, `sqlclosecheck`, `rowserrcheck` |
| go-ctx-first | golangci-lint `containedctx`, `contextcheck`, `noctx` |
| go-prealloc | golangci-lint `prealloc` |
| go-globals | golangci-lint `gochecknoglobals` |
| go-test-helper | golangci-lint `thelper` |
| version gating (API too new for the floor) | vet `stdversion` (default under `go test` since 1.27) |
| deprecated APIs | SC SA1019 |
| modernizations in section 5 | `go fix ./...` (1.26+) |
| vulnerable dependencies | `govulncheck ./...` — https://go.dev/doc/security/vuln/ |

No linter decides: error-wrap choice (`%w` vs `%v`), interface placement,
generics fit, goroutine ownership, lock scope, hot-path relevance, or
whether a `go` directive makes a rule apply. Those are the review's work.
