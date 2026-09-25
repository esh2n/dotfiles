# Go Performance Catalog

Fuller reference than `SKILL.md`'s decision tables. Each row: what/when,
pitfall, Go version (only listed if ≥1.21 — otherwise it's been true since
early Go), and source (see `sources.md` for full URLs).

## Methodology

| What / when | Pitfall | Version | Source |
|---|---|---|---|
| Measure before optimizing — profile or benchmark first, always | Reasoning from source-reading alone ("this looks slow") is not evidence; the compiler and GC frequently defy intuition | — | go-perfbook, dave.cheney.net workshop |
| USE method (Utilization / Saturation / Errors) for system-level triage | Chasing a single metric (e.g. CPU%) misses saturation (queueing) or errors that share the same resource | — | brendangregg.com USE method |
| `benchstat` requires `-count≥10` per side for a valid comparison | A single run's "faster" number is often within noise; benchstat's Mann-Whitney U-test needs the sample size to say so with a p-value | — | pkg.go.dev/.../benchstat |
| PGO (profile-guided optimization): collect a real-traffic CPU profile, save as `default.pgo`, let `go build` pick it up automatically | Profile drifts from source over time (refactors, new hot paths); stale profiles under-optimize but don't actively regress | 1.20 (available), 1.21 (`-pgo=auto` default) | go.dev/doc/pgo |
| Diagnostics decision map: pprof for "where," trace for "when/how long," runtime/metrics + GODEBUG for "is it healthy" | Running CPU profiling and precise memory profiling simultaneously skews both — isolate tools | — | go.dev/doc/diagnostics |

## Measurement Tools

| What / when | Pitfall | Version | Source |
|---|---|---|---|
| `testing.B.Loop()` replaces `for i := 0; i < b.N; i++` — auto timer scoping, keeps args alive against dead-code elimination, single ramp-up | Old `b.N` loops silently measure near-zero time if the compiler proves the result unused; `ResetTimer`/`StopTimer` calls are easy to forget or misplace | 1.24 (introduced); 1.26 (no longer blocks inlining into loop body) | go.dev/blog/testing-b-loop |
| `go tool pprof -http=:0 profile.pprof` — interactive flame graph / graph / source-annotated view | `web`/`weblist` need graphviz installed locally; headless CI needs `-top`/`-list`/`-svg` instead | — | go.dev/blog/pprof |
| Heap profile `-sample_index=alloc_space` vs `inuse_space` | `alloc_space` = cumulative bytes ever allocated (GC pressure), `inuse_space` = bytes live right now (retention/leak) — optimizing one can look flat or worse on the other | — | pkg.go.dev/runtime/pprof |
| `pprof -diff_base=old.pprof new.pprof` — confirms which function's cost actually changed | Skipping this step means accepting "it got faster" without proof the hypothesized function is why | — | go.dev/blog/pprof (usage pattern), pkg.go.dev/runtime/pprof |
| `runtime/pprof` profile types: cpu, heap, allocs, goroutine, goroutineleak, block, mutex, threadcreate | Block/mutex profiles are off by default (`runtime.SetBlockProfileRate`, `SetMutexProfileFraction`) — zero samples doesn't mean zero contention, it means profiling was never enabled | goroutineleak: 1.26 experimental → 1.27 GA | pkg.go.dev/runtime/pprof, go.dev/doc/go1.26, go.dev/doc/go1.27 |
| `runtime/metrics.Read` — stable, string-keyed runtime stats (GC, memory, scheduler), supersedes `runtime.ReadMemStats`/`debug.ReadGCStats` | Struct-field-based `ReadMemStats` won't gain new metrics; `runtime/metrics` is the extensible source of truth going forward | — | pkg.go.dev/runtime/metrics |
| `GODEBUG=gctrace=1` — one line per GC cycle: pause time, heap before/after, CPU % | Verbose on a busy service; redirect to a ring-buffered log, don't leave it on unfiltered in production long-term | — | go.dev/doc/diagnostics |
| `runtime/trace` + `go tool trace` — goroutine scheduling, GC pauses, syscalls on a timeline | Full traces on a long-running service generate huge files; use `FlightRecorder` (1.25) for on-demand snapshots instead | — | go.dev/doc/diagnostics |
| `trace.FlightRecorder` — in-memory ring buffer of recent trace data, snapshot on demand (`MinAge`/`MaxBytes` config, `fr.WriteTo`) | Not a replacement for full tracing when you need the *entire* run, only the window right before a detected problem | 1.25 | go.dev/blog/flight-recorder |
| `go run golang.org/x/tools/go/analysis/passes/fieldalignment/cmd/fieldalignment@latest ./...` — flags struct padding waste | Reordering for minimum size can put frequently-written fields from different goroutines on the same cache line (false sharing) — don't run blindly on structs with deliberate padding | — | (tool doc, not separately fetched — see SKILL.md for command) |

## Memory

| What / when | Pitfall | Version | Source |
|---|---|---|---|
| Escape analysis via `go build -gcflags=-m` (or `-m=2`/`-m=3` for detail) | Escapes across function/package boundaries are conservative — the compiler can't always prove a pointer is safe to keep on the stack, even when it "obviously" is | — | go.dev/wiki/CompilerOptimizations |
| Escape forcers: returning `&local`, storing into an `interface{}`, passing to `...any` variadic, closures that outlive the function | Fixing one forcer doesn't help if another remains on the same value — check `-gcflags=-m` output after the change, not just before | — | go.dev/wiki/CompilerOptimizations, dave.cheney.net workshop |
| noscan objects — a struct with zero pointer fields skips GC scanning entirely | One pointer field (including a string or slice header) makes the *whole struct* scannable; grouping pointerful fields together keeps the rest noscan | — | (runtime GC behavior; see gc-guide for scan-cost context) |
| GOGC: target-heap-after-GC ratio; doubling GOGC ≈ halves GC CPU, doubles heap overhead | Tuning GOGC without checking `runtime.gcBgMarkWorker`/`mallocgc` profile shares first is guessing | — | go.dev/doc/gc-guide |
| GOMEMLIMIT: soft ceiling on runtime-visible memory (`Sys - HeapReleased`), 5-10% headroom recommended | Setting it equal to the hard container limit with no headroom risks GC thrashing (constant collection, stalled program) when non-Go memory (cgo, mmap) isn't accounted for | 1.19 | go.dev/doc/gc-guide, pkg.go.dev/runtime/debug |
| Ballast trick (pre-allocate a large unused object to raise live-heap baseline) is obsolete | `GOMEMLIMIT` does the same job more directly with no code change — delete ballast code found in legacy services | obsolete since 1.19 | go.dev/doc/gc-guide |
| `runtime.AddCleanup` over `runtime.SetFinalizer` | `SetFinalizer` resurrects the object (passes it to the finalizer), delaying reclamation and breaking on cycles; `AddCleanup` takes a separate argument so the object reclaims immediately | 1.24 | go.dev/blog/cleanups-and-weak |
| `weak.Pointer[T]` — reference that doesn't prevent GC | Useful for cache maps; `.Value()` can return `nil` at any point once the GC reclaims the target — every read must handle that | 1.24 | go.dev/blog/cleanups-and-weak |
| Swiss-table map redesign — SIMD-friendly probing, higher load factor | No API change, but microbenchmark gains (up to 60%) don't uniformly apply — some access patterns saw minor regressions | 1.24 | go.dev/blog/swisstable |
| Green Tea GC — 10-40% GC CPU reduction, extra ~10% on newer amd64 via vector instructions | Default in 1.26; `GOEXPERIMENT=nogreenteagc` opt-out exists for isolating a regression but is expected to be removed | default since 1.26 (experimental in 1.25) | go.dev/doc/go1.26 |
| Maps never shrink after deletes; a peak-then-drain map holds peak memory | Rebuild into a fresh map periodically, or bound size, for caches that spike and drain | — | (well-established runtime behavior) |
| Subslice `s[a:b]` retains the entire backing array | Copy out (`append([]byte(nil), s[a:b]...)`) before dropping the reference to the original, if the subslice will long-outlive it | — | (well-established slice semantics) |

## CPU

| What / when | Pitfall | Version | Source |
|---|---|---|---|
| Inlining budget ≈ 80 AST nodes; no closures/defer/recover/select; `//go:noinline` opts out | PGO makes inlining more aggressive specifically at profile-hot call sites — a function that "shouldn't" inline by the static budget may inline anyway with a profile present | — | go.dev/wiki/CompilerOptimizations |
| Bounds-check elimination — compiler drops checks it can prove redundant (e.g. after `if i < len(s)`) | `-gcflags="-d=ssa/check_bce/debug=1"` shows what wasn't eliminated; restructuring the loop to make the bound provable is the fix, not manual unsafe indexing | — | go.dev/wiki/CompilerOptimizations |
| Devirtualization — interface call resolved to concrete call when the compiler can prove the concrete type | PGO helps here too: a profile showing one dominant concrete type at a call site enables devirtualization that static analysis alone couldn't prove | — | go.dev/doc/pgo (inlining as the cited example; devirtualization is a related PGO-assisted optimization) |
| `fmt`/`reflect`-based paths (`Sprintf`, `encoding/json` via `interface{}`) are allocation- and reflection-heavy | Fine on cold paths; measurably worse than a hand-written or code-generated path in a hot loop | — | dave.cheney.net workshop, go-perfbook |
| `slog` argument evaluation is eager | An expensive argument to a filtered-out log call still runs; guard with `Enabled()` or use a `LogValuer` | — | (stdlib `log/slog` behavior) |
| `simd/archsimd` (amd64-only, unstable API) | Experimental, not covered by the compatibility promise — do not ship in production code | 1.26 | go.dev/doc/go1.26 |
| Portable `simd` package (`GOEXPERIMENT=simd`, adds arm64/wasm support) | Still experimental as of 1.27 — status may change in future releases, re-verify before relying on it | 1.27 | go.dev/doc/go1.27 |
| `encoding/json/v2` / `jsontext` — up to 10x faster unmarshal, stricter UTF-8/duplicate-key validation | Went from experimental (`GOEXPERIMENT=jsonv2`, 1.25) to backing the default `encoding/json` in 1.27 — check the target toolchain's actual behavior with `go doc`, don't assume based on version alone | experimental 1.25 → default 1.27 | go.dev/blog/jsonv2-exp, go.dev/doc/go1.27 |

## I/O & Runtime

| What / when | Pitfall | Version | Source |
|---|---|---|---|
| `io.Copy` uses `ReaderFrom`/`WriterTo` automatically when available (e.g. `sendfile` for files/sockets) | Hand-rolled copy loops lose this optimization for no benefit — only bypass `io.Copy` for a specific streaming/transform need | — | (stdlib `io` package behavior) |
| `bufio.Reader`/`Writer` around raw file/socket I/O | Every unbuffered small read/write is a syscall; this is one of the highest-leverage, lowest-risk fixes available | — | dave.cheney.net workshop |
| `http.Transport.MaxIdleConnsPerHost` defaults to 2 | A service fanning out many concurrent requests to one host repeatedly opens/closes connections unless raised explicitly | — | (stdlib `net/http` default) |
| `database/sql` pool (`SetMaxOpenConns`, `SetMaxIdleConns`, `SetConnMaxLifetime`) unset by default | Unbounded by default — under load, can exhaust the database's own connection limit; size deliberately | — | (stdlib `database/sql` default) |
| Container-aware `GOMAXPROCS` — reads cgroup CPU limit, re-checks periodically | Fixes chronic throttling from `GOMAXPROCS` exceeding the cgroup quota, but spiky workloads that used to "borrow" brief CPU bursts beyond the average limit may see new latency | 1.25 | go.dev/blog/container-aware-gomaxprocs |
| `goroutineleak` pprof profile — flags goroutines blocked on a primitive that can never unblock | Experimental (`GOEXPERIMENT=goroutineleakprofile`) in 1.26, generally available in 1.27 — confirm with `go doc runtime/pprof` on the actual toolchain before depending on it | 1.26 experimental → 1.27 GA | go.dev/doc/go1.26, go.dev/doc/go1.27 |
