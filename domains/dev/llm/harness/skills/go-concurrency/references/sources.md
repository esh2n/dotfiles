# Sources

Every URL below was fetched and verified on 2026-08-27. Re-verify after any
future edit to this skill — dead links rot fast on version-specific pages.

## Go Memory Model & Language Spec

| URL | Verifies |
|---|---|
| https://go.dev/ref/mem | Happens-before rules used in SKILL.md's memory-model section: `go` statement, unbuffered/buffered channel send-receive, channel close, `Mutex`/`RWMutex` `Unlock`→`Lock`, `sync.Once`, `sync/atomic` sequential consistency. Also the explicit warning against double-checked locking / busy-wait idioms and "don't be clever." |
| https://go.dev/ref/spec#Select_statements | `select` evaluation order and the **uniform pseudo-random selection** among simultaneously-ready cases (used in the `select` fairness pitfall); nil-channel send/receive blocking forever. |
| https://go.dev/ref/spec#Go_statements | `go` statement semantics — arguments evaluated in the calling goroutine, return values discarded. |

## Official Blog & Wiki

| URL | Verifies |
|---|---|
| https://go.dev/blog/pipelines | Pipeline pattern, `done`-channel (or-done) cancellation, fan-in — the "only the sender closes a channel" rule. |
| https://go.dev/blog/context | `context.Context` passed as first argument, `WithCancel`/`WithTimeout`/`WithDeadline`, cancellation propagating to derived contexts, `context.Value` used for request-scoped data with unexported key types. |
| https://go.dev/blog/loopvar-preview | Go 1.22 per-iteration loop variable scoping and its gating on the module's `go` directive. |
| https://go.dev/blog/range-functions | Go 1.23 range-over-func: `iter.Seq`/`iter.Seq2`, how `yield` is called by the consuming loop. |
| https://go.dev/wiki/Go123Timer | Go 1.23 timer/ticker changes: unstopped timers/tickers become GC-collectible, timer channels became unbuffered/synchronous, the pre-1.23 "drain before Reset" idiom is no longer needed. |

## Release Notes

| URL | Verifies |
|---|---|
| https://go.dev/doc/go1.25 | `sync.WaitGroup.Go` method; container-aware default `GOMAXPROCS` (cgroup CPU bandwidth limit on Linux, periodic re-evaluation); `testing/synctest` graduating from experiment to general availability. |
| https://go.dev/doc/go1.26 | `GOEXPERIMENT=goroutineleakprofile` — the origin of the goroutine-leak pprof profile while still experimental. |
| https://go.dev/doc/go1.27 | `goroutineleak` pprof profile reaching general availability: `runtime/pprof` support, `/debug/pprof/goroutineleak` endpoint, definition ("a goroutine blocked on some concurrency primitive... that cannot possibly become unblocked"), and the stated limitation (misses leaks reachable only through global variables or a runnable goroutine's locals). |

## pkg.go.dev — Standard Library

| URL | Verifies |
|---|---|
| https://pkg.go.dev/sync | `Mutex`/`RWMutex`/`WaitGroup`/`Once` "must not be copied after first use"; `WaitGroup.Add` must happen-before the `Wait` it's counted in; `sync.Map`'s documented sweet spot (stable-key read-heavy, or disjoint per-goroutine key sets) vs "most code should use a plain Go map instead"; `sync.Pool` items may be dropped at any time without notice. |
| https://pkg.go.dev/sync/atomic | Available atomic types (`Bool`, `Int32/64`, `Uint32/64`, `Uintptr`, `Pointer[T]`, `Value`); the doc's own caution to prefer channels/`sync` over raw atomics except in low-level, performance-critical code. |
| https://pkg.go.dev/context | `Context` interface; `WithCancelCause`/`Cause` (1.20); `WithoutCancel`, `AfterFunc` (1.21); guidance to use `Value` only for request-scoped data crossing API boundaries, not optional parameters. |
| https://pkg.go.dev/cmd/vet | Confirms `go vet` runs all checks by default unless explicit flags narrow the set — `copylocks` ("check for locks erroneously passed by value") and `lostcancel` ("check cancel func returned by context.WithCancel is called") are both in the default set. |
| https://pkg.go.dev/testing/synctest | `Test` runs a function in an isolated "bubble" with a fake clock (starts 2000-01-01 UTC, advances only when every goroutine in the bubble is durably blocked); `Wait` blocks until every other goroutine in the bubble is durably blocked. |

## pkg.go.dev — golang.org/x

| URL | Verifies |
|---|---|
| https://pkg.go.dev/golang.org/x/sync/errgroup | `Group.Go`, `Wait` (returns first non-nil error), `WithContext` (derived context canceled on first error or `Wait` return), `TryGo`, and `SetLimit(n)` — caps concurrent goroutines, `Go` blocks until capacity is free. |
| https://pkg.go.dev/golang.org/x/sync/semaphore | `Weighted`, `NewWeighted(n)`, `Acquire(ctx, n)` (blocks until `n` units free or `ctx` done), `TryAcquire(n)`, `Release(n)` — weighted bound vs a plain channel's uniform-cost bound. |
| https://pkg.go.dev/golang.org/x/sync/singleflight | `Group.Do`/`DoChan` — "makes sure that only one execution is in-flight for a given key at a time," deduplicating concurrent identical work. |
| https://pkg.go.dev/golang.org/x/time/rate | `Limiter`, `NewLimiter(r, b)` token bucket; `Allow` (non-blocking), `Reserve` (returns a delay), `Wait` (blocks respecting `ctx`) plus their `N` variants. |

## Detection Tools

| URL | Verifies |
|---|---|
| https://staticcheck.dev/docs/checks/#SA2000 | SA2xxx concurrency checks: SA2000 (`WaitGroup.Add` called inside the counted goroutine), SA2001 (empty critical section — meant to `defer` the unlock), SA2002 (`t.FailNow`/`SkipNow` called from a goroutine, which isn't allowed), SA2003 (deferred `Lock` right after locking, meant `Unlock`). |
| https://github.com/uber-go/goleak | Test-time goroutine leak detection; `goleak.VerifyNone(t)` per-test, `goleak.VerifyTestMain(m)` package-wide (preferred with `t.Parallel()`). |

## Style Guides & Catalogs

| URL | Verifies |
|---|---|
| https://github.com/uber-go/guide/blob/master/style.md | Zero-value mutexes are valid (no `new(sync.Mutex)`); channel size should be 0 or 1, anything else needs scrutiny; don't start goroutines in `init()`; don't fire-and-forget goroutines without a way to wait for them. |
| https://100go.co | Concurrency mistake catalog (chapters #55-#74) cross-referenced against `pitfalls.md`: goroutine leaks (#62), loop-variable capture (#63), non-deterministic `select` (#64), channel sizing (#67), `sync.WaitGroup` misuse (#71), `sync.Cond` (#72), `errgroup` (#73), copying a sync type (#74). |

## Explicitly Not Cited

- `github.com/samber/cc-skills-golang` — reviewed only as a prior-art reference
  per the design record; no text or examples copied from it.
