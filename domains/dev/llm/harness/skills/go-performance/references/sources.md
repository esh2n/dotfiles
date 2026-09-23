# Sources

Every URL cited in `SKILL.md` and `catalog.md`, fetched and verified via
WebFetch on 2026-08-27. All 20 resolved (dead-link check: none broken as of
that date). Facts are paraphrased in this skill's own words — no text is
copied from these pages.

| URL | Cited for | Key fact confirmed |
|---|---|---|
| https://go.dev/doc/gc-guide | GOGC/GOMEMLIMIT semantics, ballast | GOGC formula and CPU/memory tradeoff; GOMEMLIMIT soft limit with 5-10% recommended headroom; ballast trick explicitly called obsolete since Go 1.19 |
| https://go.dev/doc/pgo | PGO workflow | `default.pgo` auto-detected by `go build` since `-pgo=auto` (default since 1.21); collect from production `/debug/pprof/profile`; merge profiles via `pprof -proto`; 2-14% typical gains; profile staleness degrades but doesn't regress |
| https://go.dev/doc/diagnostics | Tool selection map | Four diagnostic categories (profiling, tracing, debugging, runtime stats) each answering a distinct question; warns that concurrent profiling can skew results |
| https://go.dev/blog/pprof | pprof usage | `top`, `list`, `web`/`weblist` commands; CPU profile via `StartCPUProfile`/`StopCPUProfile`; heap via `WriteHeapProfile`; `net/http/pprof` for live endpoints |
| https://go.dev/blog/testing-b-loop | b.Loop() | Introduced Go 1.24; fixes dead-code elimination and forgotten `ResetTimer`/`StopTimer`; single ramp-up instead of repeated `b.N` escalation; no longer blocks inlining as of 1.26 |
| https://go.dev/blog/swisstable | Swiss table maps | Shipped Go 1.24; SIMD-friendly group-of-8-slots probing; up to 60% faster in microbenchmarks, ~1.5% geomean in real programs, lower average memory via higher load factor |
| https://go.dev/blog/cleanups-and-weak | AddCleanup, weak package | Both shipped Go 1.24; `AddCleanup` takes a separate cleanup arg so the object isn't resurrected (unlike `SetFinalizer`); `weak.Pointer[T]` doesn't prevent GC, `.Value()` returns nil once reclaimed |
| https://go.dev/blog/flight-recorder | FlightRecorder | Shipped Go 1.25; in-memory ring buffer (`MinAge`/`MaxBytes`), snapshot via `fr.WriteTo`, captures "last few seconds before the problem" instead of always-on tracing |
| https://go.dev/blog/container-aware-gomaxprocs | Container-aware GOMAXPROCS | Shipped Go 1.25; reads cgroup CPU limit, rechecks periodically; fixes throttling from exceeding quota; spiky workloads may see new latency since CPU-limit is a throughput constraint, GOMAXPROCS a parallelism constraint |
| https://go.dev/blog/jsonv2-exp | encoding/json/v2 status | Experimental behind `GOEXPERIMENT=jsonv2` starting Go 1.25; up to 10x faster unmarshal, stricter UTF-8/duplicate-key handling; status confirmed to reach default in 1.27 via the go1.27 release notes below |
| https://go.dev/doc/go1.26 | Go 1.26 release notes | Green Tea GC **default** (was experimental in 1.25); goroutineleak profile experimental (`GOEXPERIMENT=goroutineleakprofile`); `simd/archsimd` experimental, amd64-only; `errors.AsType` added; no Swiss-table/weak/AddCleanup mention (those are 1.24, confirmed via their own blog posts instead) |
| https://go.dev/doc/go1.27 | Go 1.27 release notes | goroutineleak profile generally available; portable `simd` package experimental (adds arm64/wasm); `encoding/json` backed by v2 implementation by **default**; `go fix` gained new modernizers |
| https://go.dev/wiki/CompilerOptimizations | Escape analysis, inlining, BCE | `-gcflags -m` for escape analysis; inlining budget ~80 AST nodes, no closures/defer/recover/select; string/byte conversion and memclr optimizations noted |
| https://pkg.go.dev/golang.org/x/perf/cmd/benchstat | benchstat usage | Requires ≥10 runs per side; uses median + Mann-Whitney U-test by default; `-filter`/`-table`/`-row`/`-col`/`-ignore` flags; `~` means no significant difference |
| https://pkg.go.dev/runtime/pprof | Profile types | cpu, heap, allocs, goroutine, goroutineleak, block, mutex, threadcreate profiles; `StartCPUProfile`/`WriteHeapProfile`/`Lookup`/`Profiles`; goroutine labels since Go 1.9 |
| https://pkg.go.dev/runtime/metrics | runtime/metrics package | `Read(samples)` populates a caller-provided slice; `All()` lists supported metrics; covers GC/memory/scheduler; supersedes `ReadMemStats`/`debug.ReadGCStats` via string-keyed extensibility |
| https://pkg.go.dev/runtime/debug | SetMemoryLimit, SetGCPercent | `SetMemoryLimit(int64) int64` defaults to `math.MaxInt64` unless `GOMEMLIMIT` set; respected even with GC disabled; `SetGCPercent(int) int` defaults to `GOGC` env or 100; memory limit can implicitly lower the effective GC percent |
| https://github.com/dgryski/go-perfbook | General methodology, prior art | Measure-before-optimize framing; sections spanning general principles, Go-specific runtime/GC/compiler behavior, low-level/unsafe, profiling tooling, and whole-service optimization; explicitly workload/measurement-driven rather than prescriptive |
| https://dave.cheney.net/high-performance-go-workshop/dotgo-paris.html | Benchmarking discipline, escape analysis, allocation reduction | `-count`+benchstat for valid comparisons; `-benchmem`; escape analysis via `-gcflags=-m`; preallocate/`strings.Builder`/`bufio`/`sync.Pool` as allocation-reduction techniques; "profile before optimizing" |
| https://www.brendangregg.com/USEmethod/use-linux.html | USE method | Utilization/Saturation/Errors framework applied uniformly across CPU, memory, storage, network, and software resources (locks, file descriptors) for systematic triage |

## Dropped

None. All 20 primary URLs specified for this skill were fetched successfully
and are cited above.

## Not independently verified via WebFetch (stated as well-established stdlib behavior)

These facts are cited in `SKILL.md`/`catalog.md` without a dedicated fetch —
they are standard library defaults/semantics stable across the supported Go
versions, not version-sensitive claims:
- `http.Transport.MaxIdleConnsPerHost` default of 2 (`net/http` package docs)
- `database/sql` connection pool defaults being unbounded/unset
- `io.Copy`'s use of `ReaderFrom`/`WriterTo` when available
- Go maps not shrinking their backing storage after deletes
- Subslices retaining a reference to the full backing array
- The `fieldalignment` analyzer's install command (given directly in the
  design record this skill implements, not re-verified via WebFetch)

If any of these needs a citable primary source later, fetch
`pkg.go.dev/net/http`, `pkg.go.dev/database/sql`, and `pkg.go.dev/io`
respectively and add rows above.
