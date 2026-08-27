---
name: go-concurrency
description: Use when writing or reviewing goroutines, channels, sync primitives, context cancellation, worker pools, or anything touching leaks, races, deadlocks, or lock contention in Go. Covers channel/mutex/atomic choice, ownership and lifetime discipline, the Go memory model, and version-gated concurrency APIs (1.22-1.27).
metadata:
  verified: 2026-08
---

# Go Concurrency

## Overview

Judgment for concurrent Go: which primitive to reach for, who owns a
goroutine's lifetime, what the memory model actually guarantees, and which
review agent a given finding belongs to. Pattern code lives in
`references/patterns.md`, the bug catalog in `references/pitfalls.md`, every
source is verified in `references/sources.md`.

## Which Agent Owns What

| Finding | Owner | Why |
|---|---|---|
| Data race, goroutine leak, deadlock, lost wakeup | `go-reviewer` | Correctness — wrong answer or hang, not "slower" |
| Lock contention (measured), mutex vs atomic choice, `sync.Pool` suitability | `go-perf-reviewer` | Only resolvable by profiling; the code is correct either way |

**Boundary rule:** if dropping the finding produces a wrong result or a hang, it's `go-reviewer`; if it only makes the program slower, it's `go-perf-reviewer`. Example: a `Mutex` held too long during I/O that also causes a downstream deadlock is `go-reviewer`; the same `Mutex` merely serializing hot-path CPU work is `go-perf-reviewer`.

## Decision Tables

### Channel vs Mutex vs atomic vs sync.Map

| Need | Use | Why |
|---|---|---|
| Hand a value's ownership to another goroutine | channel | "Share memory by communicating" — the value has one owner at a time by construction |
| Protect mutable state with a multi-step critical section | `sync.Mutex`/`RWMutex` | Correct, readable default; wrap the whole invariant, not each field |
| Single counter/flag/pointer on a hot path, one atomic op per update | `sync/atomic` typed types (`atomic.Int64`, `atomic.Bool`, `atomic.Pointer[T]`) | Lock-free CAS beats `Lock`/`Unlock` overhead — but only when the operation truly is one atomic step; two atomics is not one critical section, it's two race windows |
| Map read far more than written, or disjoint keys per goroutine | `sync.Map` | Stdlib doc's own criteria; a map guarded by `Mutex` is faster and simpler otherwise — don't default to `sync.Map` |

### Unbuffered vs Buffered Channels

- **Unbuffered**: synchronous handoff — sender blocks until a receiver takes the value. Use when you need the rendezvous itself (e.g. "worker has started").
- **Buffered**: decouples producer pacing from consumer pacing. Size the capacity to the thing you're actually bounding — the number of concurrent producers a fan-in collects from, or the burst you must absorb — never "make it big to be safe." An oversized buffer hides backpressure bugs and just delays the OOM.

### WaitGroup vs errgroup vs semaphore.Weighted

| Need | Use |
|---|---|
| Launch N goroutines, wait for all, no error propagation | `sync.WaitGroup` (or `wg.Go(f)` on Go 1.25+) |
| Launch N goroutines, cancel siblings on first error, return that error | `errgroup.Group` via `errgroup.WithContext(ctx)` |
| Cap concurrency at exactly N in flight | `errgroup.Group.SetLimit(n)` when you also need error propagation; `semaphore.Weighted` when resources have non-uniform weight or you're not already using errgroup |

### Context Cancellation

| Situation | API |
|---|---|
| Cancel and record *why* | `context.WithCancelCause` + `context.Cause(ctx)` |
| Detached cleanup that must keep request-scoped values but not die with the request | `context.WithoutCancel` |
| Run cleanup exactly when `ctx` becomes done, no goroutine+select boilerplate | `context.AfterFunc(ctx, f)` |
| Plain manual cancel, no cause needed | `context.WithCancel` |

### When `time.After` Is Wrong

Every `time.After` call allocates a fresh `Timer`. Inside a loop or a `select` that re-executes, that's a new timer per iteration — a real leak pre-1.23 (the timer lives until it fires), and still a needless allocation post-1.23. Use a single `time.NewTimer` with `Reset` (Go 1.23+ made `Reset`/`Stop` safe without draining the channel first — see `references/patterns.md`), or `context.WithTimeout` when the wait should be cancellable.

## Ownership & Lifetime Discipline

- **Every goroutine has an owner** — the function that starts it is responsible for knowing how it stops: via `ctx.Done()`, a channel close, or a `WaitGroup`. A goroutine started and never awaited is a leak by construction, not a maybe.
- **Exactly one owner closes a channel**, and only after all senders are done — never the receiver, never more than once. Closing a channel you don't fully own panics on double-close or send-on-closed from a sibling.
- Structured patterns (sketches in `references/patterns.md`):
  - **Worker pool** — fixed N goroutines pull from a shared jobs channel; prefer `errgroup.SetLimit` when the bound should flex with error handling.
  - **Pipeline** — stages connected by channels; each stage owns and closes its own out channel.
  - **Fan-in / fan-out** — fan-out is N workers reading one channel; fan-in merges N channels into one, and the merger closes the output only after a `WaitGroup` covering all inputs completes.
  - **or-done** — wrap a channel op in a `select` against `ctx.Done()` so a blocked send/receive can't leak the goroutine forever.
  - **Bounded parallelism** — `semaphore.Weighted` or a buffered channel used as a token bucket.
  - **Graceful shutdown** — `signal.NotifyContext` + context propagation + a shutdown deadline.

## Go Memory Model in 10 Lines

Happens-before edges that actually exist ([go.dev/ref/mem](https://go.dev/ref/mem)):

1. Within one goroutine, effects are observed in program order — this says nothing about other goroutines.
2. A `go` statement happens-before the started goroutine begins executing.
3. A receive from an unbuffered channel happens-before the corresponding send completes; a send happens-before the corresponding receive completes on a buffered channel.
4. Closing a channel happens-before a receive that returns because the channel is closed.
5. The kth receive on a channel with capacity C happens-before the completion of the (k+C)th send.
6. `Unlock` happens-before a later `Lock` on the same `Mutex`/`RWMutex` returns.
7. The single `f()` call inside `once.Do(f)` happens-before any call to `once.Do(f)` returns.
8. If one atomic operation observes the effect of another, the first happens-before the second; all atomics on a variable behave as one sequentially consistent order.
9. `Done` happens-before the matching `Wait` returns, for `sync.WaitGroup`.
10. **Anything else — two plain accesses to the same variable from different goroutines with no edge above — is undefined**: a data race, not a timing question. Don't reason about scheduler behavior; run `go test -race`.

## Version-Gated APIs

| Version | Feature | Rule |
|---|---|---|
| 1.22 | Per-iteration loop variables | Only when the module's `go` directive is ≥ 1.22. On a lower floor the shadow-copy idiom (`v := v`) is still load-bearing, not cleanup |
| 1.23 | Range-over-func (`iter.Seq`/`iter.Seq2`); `Timer`/`Ticker` channels became synchronous | Iterator bodies run in the caller's goroutine unless you spawn one explicitly; post-1.23 `Reset`/`Stop` no longer need a channel drain first |
| 1.25 | `sync.WaitGroup.Go`; `testing/synctest` (GA); container-aware `GOMAXPROCS` default | `wg.Go(f)` replaces `Add(1)` + `go` + `defer Done()`; `synctest.Test` gives deterministic concurrent tests with a fake clock |
| 1.27 | `runtime/pprof` `goroutineleak` profile | Detects goroutines blocked on a primitive unreachable from any runnable goroutine — not exhaustive; misses leaks reachable through globals or a live goroutine's locals |

**Rule:** check the module's `go` floor in `go.mod` and run `go doc <pkg>.<Symbol>` before using any of these — don't rely on memory for API existence or since-version.

## Detection Tools

| Tool | Catches | When |
|---|---|---|
| `go vet` (default analyzers) | `copylocks` (a `Mutex` copied by value), `lostcancel` (a `context.CancelFunc` discarded without being called) | Every build/CI |
| `staticcheck` `SA2xxx` | Concurrency-specific misuse — see `references/sources.md` for the exact check IDs verified against staticcheck.dev | CI, or the `go-guard` PostToolUse hook |
| `go test -race` | Actual data races at runtime, only on exercised paths | CI, always for concurrency-touching packages |
| `uber-go/goleak` | Leaked goroutines at test teardown (`goleak.VerifyNone`/`VerifyTestMain`) | Package tests that spawn goroutines |
| `testing/synctest` | Deterministic goroutine quiescence + fake clock — no flaky `time.Sleep` polling | Tests that wait on concurrent timing |
| pprof goroutine/mutex/block profiles | Live leaks; lock-contention and blocking hot spots (mutex/block profiles need `runtime.SetMutexProfileFraction`/`SetBlockProfileRate` enabled) | Staging/production investigation, or `go-optimize` |
| `runtime/trace` | Scheduler-level view — goroutine states, GC pauses, syscalls over time | Rare, deep latency investigations |

## Review Checklist

1. Does every goroutine have a clear owner and stop condition (`ctx`, channel close, or `WaitGroup`)?
2. Who closes each channel — exactly one owner, only after all senders finish?
3. Can any goroutine block forever on a channel/lock with no way for the caller to cancel it?
4. Is a `Mutex`/`RWMutex` ever copied by value (value receiver, struct passed by value, returned by value)?
5. Is a lock held across I/O, a channel op, or a call into code you don't control?
6. Is `time.After` used inside a loop or a repeated `select`?
7. On a pre-1.22 module: is the loop variable captured correctly by closures/goroutines?
8. Is `atomic` covering a multi-step check-then-act that actually needs a `Mutex`?
9. Is `context.WithValue` carrying a required parameter instead of optional, request-scoped metadata?
10. Does `WaitGroup.Add` ever run inside the goroutine it's counting — racing against `Wait`?
11. Does the code rely on `select` case order/priority instead of the spec's random choice among ready cases?
12. Any `defer` inside a loop that accumulates unclosed resources until the function returns?
13. Does the change add goroutines without a corresponding `-race` or `goleak` test?
14. Does `sync.Pool` hold anything whose lifetime shouldn't survive an eviction (large buffers, GC-sensitive state)?
15. Is there a send on a channel that another path might already have closed?

## Related

- `go-reviewer` agent — correctness review (race/leak/deadlock)
- `go-perf-reviewer` agent — performance review (contention, atomic vs mutex, Pool)
- `go-modern` skill — idiom-level API replacements (loop vars, `errors.Join`, etc.)
- `golang-patterns` skill — general Go structure and error conventions
