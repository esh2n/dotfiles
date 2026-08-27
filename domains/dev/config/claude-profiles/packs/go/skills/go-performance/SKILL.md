---
name: go-performance
description: Use when optimizing Go code, profiling with pprof, writing or reading benchmarks, tuning GOGC/GOMEMLIMIT/GOMAXPROCS, chasing allocations, GC pauses, latency, or throughput, or asked "why is this slow" — judgment for what to measure, which knob to reach for, and what to label verified vs unverified.
metadata:
  verified: 2026-08
---

# Go Performance

## Overview

Judgment for Go performance work: what to measure before touching code,
which knob answers a given throughput/latency/memory question, and how to
tell a real fix from a plausible-looking one. Full catalog in
`references/catalog.md`, anti-patterns in `references/antipatterns.md`,
sources in `references/sources.md`.

## Which Agent Owns What

`go-perf-reviewer` reads this skill for methodology and knobs; it reads
`go-concurrency` for primitive choice (mutex vs atomic vs channel) since
that's a design-time decision, not a measurement one. The `go-optimize`
workflow runs the full loop below end to end, gated by benchstat and a
verifier pass.

One-line rule: **a claim this skill can settle by profiling or benchmarking
is "measure it"; a claim about which primitive to write belongs to
`go-concurrency` or `go-modern`.**

## Measure First — The Loop

Never ship a performance change on the strength of reasoning alone. The
evidence chain a reviewer demands, in order:

1. **Baseline** — `go test -bench=X -count=10 -benchmem ./...` on the
   unmodified code. Ten runs, not one — noise on a shared machine swamps a
   single sample.
2. **Profile** — `go test -bench=X -cpuprofile=cpu.pprof -memprofile=mem.pprof`,
   then `go tool pprof -http=:0 cpu.pprof`. For memory, capture both
   `-sample_index=alloc_space` (where bytes are allocated, guides GC-pressure
   fixes) and `-sample_index=inuse_space` (what's live at profile time,
   guides leak/retention fixes) — they answer different questions and a fix
   aimed at one can look like a regression on the other.
3. **Hypothesis** — name the specific function/allocation/lock the profile
   points at and what change should shrink it. "Might help" is not a
   hypothesis; "shrinks `encodeRow`'s allocs by avoiding the `[]byte(string)`
   conversion" is.
4. **One change** — a single variable per round. Two changes at once and a
   regression in one is invisible in the aggregate number.
5. **Re-measure** — same bench, same `-count=10`, same machine/load
   conditions as the baseline.
6. **benchstat** — `go run golang.org/x/perf/cmd/benchstat@latest old.txt new.txt`.
   Accept only p < 0.05 (Mann-Whitney U-test); a `~` in the output means "no
   significant difference," not "roughly the same, ship it."
7. **Mechanism check** — `go tool pprof -diff_base=cpu_old.pprof cpu_new.pprof`
   and confirm the *targeted* function actually shrank. A benchmark can
   improve for a reason unrelated to the hypothesis (noise, a JIT-like
   inlining side effect, GC phase luck) — the diff is what proves the
   mechanism, not just the outcome.

**Two output labels, always:**
- **verified** — has a benchstat p < 0.05 result *and* a diff_base showing
  the hypothesized function shrank.
- **unverified** — everything else, including "obviously" true claims
  (`defer` in a hot loop, `fmt.Sprintf` for concatenation). State the claim,
  state that it is unverified, do not imply measurement happened.

## Decision Tables

### Throughput vs Latency — Which Knob

| Symptom | Reach for | Not |
|---|---|---|
| High steady-state CPU from GC, memory headroom available | Raise `GOGC` (e.g. 100→200) | Lowering `GOMAXPROCS` |
| Memory spikes near a container limit, GC too lazy to react | `GOMEMLIMIT` set to container limit minus 5-10% headroom | Raising `GOGC` alone (no ceiling) |
| Tail latency from GC pauses under bursty allocation | Lower `GOGC`, or set both `GOGC` + `GOMEMLIMIT` together | `GOGC=off` (removes the only lever) |
| Throttled/paused execution in a container despite spare host CPU | Confirm Go ≥1.25's container-aware `GOMAXPROCS` picked up the cgroup limit; do not hand-tune `GOMAXPROCS` first | Manually pinning `GOMAXPROCS` to host `NumCPU` |
| CPU-bound work not scaling with cores | Check worker/goroutine pool sizing against `GOMAXPROCS`, not thread count | Adding more goroutines blindly |

### sync.Pool: Helps vs Hurts

| Shape | Verdict |
|---|---|
| Large object (buffer, big struct), short-lived, allocated in a hot loop | Helps — classic case (`bytes.Buffer`, JSON encoder scratch) |
| Small object (<~a few words) | Rarely helps — pool bookkeeping can cost more than the allocation it avoids |
| Object lifetime crosses a GC cycle boundary unpredictably | Hurts or no-ops — Pool contents can be cleared any GC, so held-too-long objects just get reallocated anyway |
| Low-frequency path | Skip — Pool overhead (interface boxing, `sync.Pool` internals) isn't worth it below hot-path call rates |
| Needs zeroing/reset guarantees | Must reset explicitly on Get — Pool does not zero for you |

### Generics vs Interface

| Situation | Use |
|---|---|
| Identical function body across types, no per-type behavior | Generic (type parameter) |
| Behavior genuinely differs per type | Interface — that's what dynamic dispatch is for |
| Value type, small, hot path, want to avoid boxing/heap escape | Generic with a concrete type parameter |
| Pointer-shaped, mutation through the abstraction, or a plugin-style seam | Interface |

### Preallocate vs Grow

| Known length/capacity ahead of the loop | `make([]T, 0, n)` / `make(map[K]V, n)` |
| Length only known approximately or unbounded | Grow naturally — over-preallocating wastes memory for no benefit |
| Appending in a loop with no cap hint | Preallocate if `n` is knowable (even a query `COUNT(*)`, a known batch size); otherwise let `append`'s doubling do its job |

### Mutex vs Atomic vs Sharding

Full primitive-choice table lives in `go-concurrency`. For performance
specifically: a single hot counter under contention → `sync/atomic`; a
struct with related invariants under contention → keep the mutex and shard
by key (`N` mutex+map pairs, hash the key to pick a shard) before reaching
for `sync.Map`. Sharding trades memory for reduced contention — verify the
contention is real via a mutex profile before sharding, not before.

### When to Reach for PGO

| Situation | PGO worth it |
|---|---|
| Hot functions vary by real production traffic shape (not synthetic) | Yes — collect from `/debug/pprof/profile?seconds=30` in prod |
| CPU-bound service with stable-ish call graph across releases | Yes — commit `default.pgo`, `go build` picks it up automatically |
| Short-lived CLI, or a codebase that refactors function boundaries constantly | No — profile goes stale fast, gains (2-14% typical) aren't guaranteed |
| Already applied targeted allocation/algorithmic fixes | Apply PGO last — it's a compiler-level multiplier on top of correct code shape, not a substitute for fixing an O(n²) loop |

## Memory Judgment

| Topic | What to know |
|---|---|
| Escape analysis | `go build -gcflags=-m` (add `=2` or `=3` for more detail) shows what escapes and why. Common forcers: returning a pointer/slice from a function, storing into an interface, passing to a variadic `...any`, a closure that outlives the function, taking `&localVar` and passing it somewhere the compiler can't prove doesn't escape |
| noscan objects | A struct with zero pointer fields is "noscan" — GC skips scanning it entirely. Adding **one** pointer field (even `*T`, a slice, a map, a string) makes the *whole struct* scannable, not just that field. Group pointer fields together or split hot noscan data from pointer-bearing metadata |
| Maps never shrink | A Go map's backing memory does not shrink after deletes. A map that grows to a peak and stays there holds that memory until dropped entirely. For a cache that peaks and drains, periodically rebuild into a fresh map, or size-bound it |
| Subslice retains backing array | `s[a:b]` keeps the entire original backing array alive as long as the subslice is referenced — a 10-byte subslice of a 10MB slice pins the 10MB. Copy out (`append([]byte(nil), s[a:b]...)`) when the subslice will outlive the original |
| Field alignment vs false sharing | Struct field order affects padding (fieldalignment tool reorders for minimum size) *and*, separately, hot fields written by different goroutines on the same cache line cause false sharing — pad to a cache line (`64` bytes) to separate them. These are opposite goals: don't blindly run fieldalignment on a struct with deliberately separated hot fields |
| GOGC | Target-heap-after-GC knob; doubling GOGC roughly halves GC CPU cost, doubles heap overhead. See decision table above |
| GOMEMLIMIT | Soft ceiling on runtime memory (`Sys - HeapReleased`); leave 5-10% headroom for memory the runtime doesn't see (cgo, mmap). Since Go 1.19 |
| Ballast | The pre-Go-1.19 "allocate a big unused slice to raise the live-heap baseline" trick is obsolete since `GOMEMLIMIT` shipped in 1.19 — delete it if found in old code |
| runtime.AddCleanup vs SetFinalizer | Since Go 1.24, prefer `AddCleanup` — it takes a separate cleanup argument instead of the object itself, so the object's memory can be reclaimed immediately instead of being resurrected. `SetFinalizer` is still correct only for pre-1.24 modules |
| weak package | Since Go 1.24, `weak.Pointer[T]` references an object without keeping it alive — the classic use is a cache map that doesn't itself prevent eviction; `.Value()` returns `nil` once the GC has reclaimed the target |
| Swiss tables | Go 1.24 shipped a redesigned map (Swiss-table-style, SIMD-friendly probing): up to 60% faster in microbenchmarks, ~1.5% geomean in real programs, and a lower average memory footprint from a higher load factor. No API change — informational only |
| Green Tea GC | Default since Go **1.26** (was experimental in 1.25) — 10-40% GC CPU reduction reported, more on newer amd64 via vector instructions. Opt out with `GOEXPERIMENT=nogreenteagc` if isolating a regression, but the opt-out itself is expected to go away |

## CPU Judgment

| Topic | What to know |
|---|---|
| PGO workflow | Commit `default.pgo` next to `main`; `go build` auto-detects it (`-pgo=auto` is the default since 1.21). Merge multiple profiles with `go tool pprof -proto a.pprof b.pprof > merged.pprof`. Re-collect periodically — accuracy degrades as source drifts from the profiled version |
| Inlining budget | The compiler inlines simple functions under roughly an 80-AST-node budget with no closures/defer/recover/select and no `//go:noinline`. `-gcflags=-m` shows inline decisions; PGO makes inlining more aggressive for profile-hot call sites specifically |
| Bounds-check elimination | The compiler drops redundant bounds checks when it can prove an index is in range (e.g. after `if i < len(s)`, or iterating `for i := range s`). `-gcflags="-d=ssa/check_bce/debug=1"` shows what wasn't eliminated. Restructuring a loop to make the bound provably safe (hoist the check once) is a real, measurable win in tight loops |
| Devirtualization | The compiler can resolve an interface method call to a concrete call when it can prove the concrete type at compile time (common after PGO identifies a dominant type at a call site) — reduces indirect-call overhead |
| b.Loop | Since Go 1.24, `for b.Loop() { ... }` replaces `for i := 0; i < b.N; i++`: automatic timer scoping, keeps args alive so the compiler can't dead-code-eliminate the body, single ramp-up instead of repeated re-invocation with escalating `b.N`. As of 1.26 it no longer blocks inlining into the loop body |
| Avoid fmt/reflect in hot paths | `fmt.Sprintf`/`fmt.Errorf` and anything using `reflect` (including `encoding/json` via `interface{}`) allocate and walk types dynamically — orders of magnitude slower than a direct type-specific path. Reserve for cold paths (errors, startup, logs at debug level actually emitted) |
| slog eager args | `slog.Info("msg", "key", expensiveCall())` evaluates `expensiveCall()` even if the log level filters the line out. Guard expensive arguments with `if logger.Enabled(ctx, level)` first, or pass a `slog.LogValuer` that defers the work |
| SIMD | `simd/archsimd` (1.26, amd64-only, unstable API) and the portable `simd` package (1.27, `GOEXPERIMENT=simd`, adds arm64/wasm) are both **experimental** as of 1.27 — do not suggest for production code; note as an unverified/future option only |

## I/O & Runtime

| Topic | What to know |
|---|---|
| io.Copy | Automatically uses `ReaderFrom`/`WriterTo` when the underlying types implement them (e.g. `*os.File`, `net.Conn` on Linux via `sendfile`) — avoids the intermediate buffer copy. Don't hand-roll a copy loop over `io.Copy` without a specific reason |
| bufio | Wrap raw `os.File`/`net.Conn` reads and writes in `bufio.Reader`/`bufio.Writer` for anything doing many small I/O calls — unbuffered small reads/writes are a syscall each |
| http.Transport pooling | `MaxIdleConnsPerHost` defaults to 2 — low for a service making many concurrent requests to the same host. Raise it explicitly (and `MaxIdleConns`) when fan-out to one host is high, or connections get opened and torn down repeatedly |
| database/sql pool | `SetMaxOpenConns`/`SetMaxIdleConns`/`SetConnMaxLifetime` are unset (unlimited/no idle limit) by default — an unbounded pool under load can exhaust DB connections. Size to the DB's actual connection budget, not "as many as Go wants" |
| Container-aware GOMAXPROCS | Since Go **1.25**, the runtime reads the cgroup CPU limit (not just `NumCPU`) and re-checks periodically as the limit changes — fixes the old failure mode of exceeding the cgroup quota and getting throttled (which pauses the whole process for the rest of the throttling period, not just slows it). Spiky workloads may see *more* latency post-upgrade since short CPU bursts beyond the average limit are now prevented rather than borrowed |
| FlightRecorder | Since Go **1.25**, `runtime/trace.FlightRecorder` keeps an in-memory ring buffer of recent trace data (`MinAge`/`MaxBytes` configured) and snapshots it on demand (`fr.WriteTo`) — captures "the last few seconds before the problem" instead of requiring always-on tracing. Use for production incident capture, not routine profiling |
| goroutineleak profile | Experimental behind `GOEXPERIMENT=goroutineleakprofile` in Go 1.26; generally available in Go **1.27** as the `goroutineleak` `runtime/pprof` profile / `/debug/pprof/goroutineleak` — flags goroutines blocked on a primitive that can never unblock. Verify availability with `go doc runtime/pprof` on the target toolchain before relying on it |

## Tools

| Tool | Answers | Command |
|---|---|---|
| `testing.B` + `-benchmem` | Time and allocs/op for a hot function | `go test -bench=X -benchmem -count=10 -run=^$` |
| benchstat | Is a change real (statistically) or noise | `go run golang.org/x/perf/cmd/benchstat@latest old.txt new.txt` |
| pprof (cpu/heap) | Where time/memory goes; `-http` for interactive graph/flame view; `-diff_base` to compare two profiles; `-sample_index=alloc_space\|inuse_space` for heap | `go tool pprof -http=:0 cpu.pprof` |
| `runtime/trace` + `go tool trace` | Scheduling, GC pauses, syscalls relative to goroutine activity — latency breakdown, not just totals | `go tool trace trace.out` |
| `runtime/metrics` | Stable, string-keyed runtime stats (GC, memory, scheduler) for live monitoring, superseding `ReadMemStats` | `metrics.Read(samples)` |
| `GODEBUG=gctrace=1` | GC event log: pause times, heap size before/after, CPU % spent in GC | `GODEBUG=gctrace=1 ./binary` |
| fieldalignment | Struct field order wasting space to padding | `go run golang.org/x/tools/go/analysis/passes/fieldalignment/cmd/fieldalignment@latest ./...` |
| `-gcflags=-m` | Escape analysis decisions and why | `go build -gcflags=-m ./...` |

## Review Checklist

Static findings are flagged always; the `measure` tag means the finding is
plausible but needs a profile/benchstat run before calling it a fix. Full
list with fixes in `references/antipatterns.md`.

| Anti-pattern | Tag |
|---|---|
| `defer` inside a tight loop (accumulates until function return) | static |
| String concatenation with `+`/`Sprintf` in a loop instead of `strings.Builder` | static |
| `regexp.Compile`/`MustCompile` inside a loop or hot function instead of a package-level var | static |
| `[]byte(s)` / `string(b)` conversion in a hot path (copies) | measure |
| Unbounded `go` per input item with no `errgroup.SetLimit`/semaphore | static |
| Decoding JSON into `interface{}`/`map[string]any` instead of a typed struct | measure |
| N+1 query pattern (query-per-row in a loop) | static |
| Cache/map with no eviction or size bound | static |
| `append` in a loop with no `cap` hint when length is knowable | measure |
| `resp.Body` (or any `io.ReadCloser`) not closed on every return path | static |
| `time.Now()` called repeatedly in a hot loop instead of once, when sub-loop precision isn't needed | measure |
| Log call with expensive unguarded arguments at a filtered level | measure |

## Related

- `references/catalog.md` — fuller catalog by area, one-liners with pitfalls and versions
- `references/antipatterns.md` — ~25 anti-patterns with fix and static/measure tag
- `references/sources.md` — every URL cited above, fetch-verified 2026-08
- `go-concurrency` skill — primitive choice (mutex/atomic/channel), goroutine lifetime
- `go-modern` skill — non-performance idiom modernization
- `go-perf-reviewer` agent — runs the measure-first loop in review/optimize workflows
