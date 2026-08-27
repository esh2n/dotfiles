# Concurrency Pitfalls Catalog

Sources verified in `sources.md`. Each entry: symptom, why it happens, fix, detector.

## Goroutine leak

- **Symptom**: goroutine count grows without bound; process RSS climbs slowly under load.
- **Why**: a goroutine blocked on a channel send/receive or a lock that will never be satisfied because its counterpart is gone — no cancellation path was wired in.
- **Fix**: give every goroutine a `ctx` (or done channel) and a `select` between the blocking op and `ctx.Done()`; the goroutine's owner must be able to signal it to stop.
- **Detector**: `runtime/pprof` `goroutineleak` profile (1.27); `uber-go/goleak` in tests; a rising `runtime.NumGoroutine()` in a metrics dashboard.

## Data race

- **Symptom**: nondeterministic wrong values, corrupted structs, occasional panics — often only under load or on multi-core CI.
- **Why**: two goroutines access the same memory, at least one a write, with no happens-before edge between the accesses (Go Memory Model).
- **Fix**: add a real happens-before edge — a `Mutex`, a channel, or a `sync/atomic` type — don't add a `time.Sleep` to "fix" the timing.
- **Detector**: `go build -race` / `go test -race` (only exercises the paths the run takes — a race not on the tested path won't be flagged).

## Deadlock

- **Symptom**: `fatal error: all goroutines are asleep - deadlock!`, or a program hangs with all goroutines blocked but the runtime doesn't detect it (e.g. one live goroutine spinning elsewhere).
- **Why**: circular wait — two or more goroutines each hold a resource the other needs, or a goroutine sends on an unbuffered channel with no receiver.
- **Fix**: establish and enforce a consistent lock-acquisition order across the codebase; prefer message passing over nested locks; verify every unbuffered send has a matching receive on a reachable path.
- **Detector**: the runtime deadlock detector catches the "all goroutines asleep" case only; partial deadlocks need `runtime/trace` or a goroutine dump (`kill -QUIT` / `/debug/pprof/goroutine?debug=2`).

## Lost wakeup

- **Symptom**: a goroutine waiting on `sync.Cond.Wait()` (or a signal channel) never wakes even though the condition became true.
- **Why**: the signal (`Signal`/`Broadcast`, or a channel send) happened before the waiter called `Wait`/started receiving — the notification isn't durable, so it's simply missed.
- **Fix**: always re-check the condition in a `for` loop around `cond.Wait()` (never `if`), and hold the associated lock while checking/updating the condition so signal and check can't interleave.
- **Detector**: no static tool catches this reliably; code review + `testing/synctest` to force deterministic interleavings.

## Close of closed / nil channel

- **Symptom**: `panic: close of closed channel` or a `nil` channel op that blocks forever (silent, not a panic).
- **Why**: two code paths both believe they own closing the channel; or a channel variable was never initialized (`nil` channel: send/receive block forever, `close` panics).
- **Fix**: exactly one designated owner closes a channel, once, typically via `sync.Once` or a dedicated closer goroutine gated by a `WaitGroup` over all senders.
- **Detector**: `go vet`'s `nilness`/`copylocks`-adjacent checks catch some nil-channel misuse; mostly caught by `-race`/tests exercising the path plus code review.

## Send on closed channel

- **Symptom**: `panic: send on closed channel`.
- **Why**: a sender is still active after another goroutine closed the channel — classic symptom of "receiver closes the channel" or multiple senders without coordination.
- **Fix**: never let the receiver close a channel it doesn't own; with multiple senders, only the last one out (tracked via `WaitGroup`) closes.
- **Detector**: caught at runtime under load; not statically detectable in general — design review via the ownership rule in `SKILL.md`.

## Unbounded goroutine spawn

- **Symptom**: memory/goroutine count spikes proportional to request volume; OOM under traffic bursts.
- **Why**: `go func()` inside a request handler or a loop with no cap — every input item gets its own goroutine with no ceiling.
- **Fix**: bound concurrency with a worker pool, `errgroup.SetLimit`, or `semaphore.Weighted` (see `patterns.md`).
- **Detector**: load testing + goroutine-count metrics; no static tool flags "too many goroutines" by itself.

## Holding a lock across I/O

- **Symptom**: throughput collapses under concurrent load even though the critical section looks small in code.
- **Why**: the `Mutex` is held while waiting on a network call, disk I/O, or another lock — every other goroutine queues behind an operation with unbounded latency.
- **Fix**: copy what you need out from under the lock, release it, then do I/O; re-acquire only to write results back.
- **Detector**: `go-perf-reviewer` via mutex-contention profiling (`runtime.SetMutexProfileFraction` + pprof); not caught by `-race` or `vet`.

## `defer` in a loop

- **Symptom**: file descriptor / memory exhaustion in a long-running function that processes many items in one call.
- **Why**: `defer` schedules to the *function's* return, not the loop iteration's end — resources pile up until the function returns.
- **Fix**: wrap the loop body in its own function (so `defer` fires per iteration), or call `Close`/`Unlock` explicitly at the end of each iteration.
- **Detector**: `staticcheck` (see `sources.md` for the specific check); resource-limit alerts in production.

## Loop-variable capture (pre-1.22)

- **Symptom**: goroutines/closures started inside a `for` loop all observe the same (usually last) value of the loop variable.
- **Why**: pre-1.22, a `for` loop has one variable shared across all iterations; a closure captures the variable, not a snapshot of its value at that iteration.
- **Fix**: bump the module's `go` directive to 1.22+ (fixes it at the language level), or add `v := v` inside the loop body on older modules.
- **Detector**: `go vet`'s loop-capture analysis on older toolchains; check the `go` directive before flagging — see `SKILL.md`'s version-gated table.

## `time.After` in a loop

- **Symptom**: elevated allocations / (pre-1.23) leaked timers in a service with a hot polling or retry loop.
- **Why**: each call to `time.After` allocates a new `Timer`; called every iteration, that's a per-iteration allocation instead of one reused timer.
- **Fix**: create one `time.NewTimer` (or `Ticker`) outside the loop and `Reset` it each iteration (Go 1.23+: safe without draining first).
- **Detector**: code review; heap-allocation profiling shows the `time.After` call site.

## `select` fairness / non-determinism

- **Symptom**: code that assumes "the first matching case in source order wins" behaves unpredictably.
- **Why**: the spec guarantees a **uniform pseudo-random selection** among all cases that can proceed simultaneously — there is no priority by source order.
- **Fix**: if priority is actually required, use nested `select`s (check the priority channel first in its own non-blocking `select`, fall through to the general one) instead of relying on case order.
- **Detector**: not statically detectable; a flaky/inconsistent test under load is the usual symptom.

## False sharing

- **Symptom**: throughput doesn't scale with added cores; per-core cache-miss counters (via `perf`) are elevated on a struct with independently-updated fields.
- **Why**: unrelated fields updated by different goroutines land in the same CPU cache line, so every write invalidates the other goroutine's cached copy even though there's no logical data race.
- **Fix**: pad hot fields to their own cache line, or restructure so each goroutine's counters live in separate allocations.
- **Detector**: CPU profiling / hardware perf counters; `go-perf-reviewer`'s measured mode, not static analysis.

## `sync.Pool` misuse

- **Symptom**: memory footprint doesn't shrink under low load, or pooled objects carry stale/leaked state into their next use.
- **Why**: `Pool` items can be evicted at any GC (no guarantee of retention) and are *not* zeroed between uses — putting an object back without resetting it leaks its old contents forward.
- **Fix**: always reset (clear buffers, drop references) before `Put`; never assume an item survives until the next `Get`; only pool objects whose alloc cost is actually the bottleneck (measure first — `go-perf-reviewer`'s territory).
- **Detector**: heap profiling before/after; code review for missing reset-before-`Put`.

## `sync.Map` misuse

- **Symptom**: `sync.Map` used as a general-purpose concurrent map is slower and uses more memory than `Mutex` + built-in `map`.
- **Why**: `sync.Map` is optimized specifically for "written once, read many times" or "disjoint key sets per goroutine" access patterns (per the stdlib doc) — outside those, its internal bookkeeping costs more than a simple lock.
- **Fix**: default to `Mutex`-guarded `map[K]V`; reach for `sync.Map` only when the access pattern matches its documented sweet spot, and measure.
- **Detector**: code review against the decision table in `SKILL.md`; benchmark comparison (`go-perf-reviewer`).

## `WaitGroup.Add` inside the counted goroutine

- **Symptom**: `panic: sync: negative WaitGroup counter`, or `Wait()` returns before all goroutines actually started.
- **Why**: `Add` must happen-before the `go` statement that starts the goroutine it's counting; calling `Add(1)` from inside the new goroutine races with a `Wait()` that may already be running (and may return `0` before the `Add` even executes).
- **Fix**: call every `Add` in the launching goroutine, before `go func() { defer wg.Done(); ... }()` — or use `wg.Go(f)` (Go 1.25+), which does this correctly by construction.
- **Detector**: `go test -race`; `go vet`'s WaitGroup misuse checks where available.

## `context.WithValue` abuse

- **Symptom**: a function's real, required inputs are hidden inside `ctx.Value(...)` lookups instead of being explicit parameters; refactoring the call chain silently breaks at runtime instead of at compile time.
- **Why**: `context.Value` is meant for optional, request-scoped metadata (trace IDs, deadlines-adjacent data) that crosses API boundaries you don't control — not for passing arguments a function actually needs to do its job.
- **Fix**: keep required inputs as explicit parameters; reserve `WithValue` for cross-cutting, genuinely optional data, with unexported key types to avoid collisions.
- **Detector**: code review only — nothing statically flags "this value should have been a parameter."

## Copying a `Mutex` by value

- **Symptom**: two goroutines appear to hold "different" locks and both enter the critical section simultaneously; corruption follows.
- **Why**: a struct containing a `sync.Mutex` was copied (passed by value, returned by value, or ranged over by value) — the copy has its own independent lock state disconnected from the original.
- **Fix**: pass structs containing a `Mutex` by pointer; never copy a locked value.
- **Detector**: `go vet`'s `copylocks` analyzer (default-enabled) — the most reliable static catch in this entire list.
