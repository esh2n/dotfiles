---
name: go-modern
description: Use when writing or reviewing Go code and a pre-1.21 idiom shows up — `v := v` loop-variable copies, hand-rolled contains/keys/sort helpers, `if a > b` min/max, `log.Printf` for structured output, channel or callback iteration, `math/rand.Seed`, `for i := 0; i < b.N; i++` benchmarks, `interface{}`/reflection where generics fit, or `omitempty` on structs and time.Time. Maps each to the current stdlib or language form and says when the old form is still correct.
metadata:
  verified: 2026-08
---

# Modern Go

## Overview

Go 1.26 (Feb 2026, current patch 1.26.2) and Go 1.25 are the supported
releases. Models write Go as if 1.19 were current: manual slice helpers,
`log.Printf`, `v := v`, `interface{}` everywhere. Each has a current form —
but several have a legitimate "still correct" case, which is the point of the
third column.

Before applying any of this, check the module's `go` directive. **A rewrite
that is correct for `go 1.24` is a bug in a module declaring `go 1.21`.**

## Replacement Table

| Legacy default models emit | Current form | When the legacy form is still right |
|---|---|---|
| `for _, v := range xs { v := v; go f(&v) }` | Nothing — since **1.22** each iteration gets a fresh variable | Module declares `go 1.21` or lower: per-iteration capture is gated on the `go` directive, so the shadow copy is load-bearing. Keep it and say why |
| Channel-based iteration (`func All() <-chan T`) or `Each(f func(T) bool)` callbacks | Range-over-func, **1.23**: `iter.Seq[T]` / `iter.Seq2[K,V]`, consumed with `for x := range s` | Producer is genuinely concurrent and needs backpressure or its own lifetime — a channel is a channel, not an iterator. Also keep callbacks in exported APIs whose module targets <1.23 |
| Hand-rolled `contains`, `indexOf`, `keys`, `reverse`, `sort.Slice` wrappers | `slices.Contains/Index/Sort/SortFunc/Reverse/Clone`, `maps.Keys/Values` (**1.21**; `maps.Keys` returns an iterator, feed it to `slices.Collect`) | Comparison needs an allocation-free custom path in a hot loop, or the helper carries domain semantics (`hasActiveAdmin`) that `slices.Contains` would obscure |
| `if a > b { m = a } else { m = b }`; `for k := range m { delete(m, k) }` | `min()`, `max()`, `clear()` builtins (**1.21**) | `min`/`max` on floats when you need explicit NaN handling — the builtin propagates NaN, which may not be what a metric aggregator wants |
| `log.Printf("user=%s err=%v", …)` | `log/slog` (**1.21**) with `slog.String`/`slog.Any` attrs | Throwaway `main.go`, tests, or CLI output meant for humans. Structured logging in a tool that prints to a terminal is noise |
| `fmt.Errorf` chains that drop siblings, or a third-party multierror package | `errors.Join` (**1.20**) for independent failures; `%w` for a single causal chain | Sequential failures where only the first matters — `Join` on an early-exit path just makes the message longer. Do not `Join` to "collect context"; that is what `%w` is for |
| `errors.As(err, &target)` with a pre-declared variable | `errors.AsType[*MyErr](err)` (**1.26**) — generic, no out-param | Targeting an interface type rather than a concrete type; `errors.As` still handles that |
| `interface{}` + type switch, or `reflect` to write one generic helper | Type parameters, when the function body is **identical** across types | Behavior differs per type (that is an interface, not a generic); a single call site (just write it concretely); constraint would need `~` gymnastics to express. Generics that exist to look modern are ceremony — an `any` parameter documented as such is often clearer |
| `go 1.21` alone in go.mod, plus a README telling contributors which Go to install | `go` + `toolchain` directives (**1.21**) — the toolchain line pins the build, the `go` line sets the language floor | Library aiming at wide compatibility: set the lowest `go` you actually support and omit `toolchain` so consumers are not forced upward. `go mod init` on 1.26 writes `go 1.25.0` |
| Cancelling a request context, then a detached `go func()` with `context.Background()` for cleanup | `context.WithoutCancel` (**1.21**) to keep values but drop cancellation; `context.AfterFunc` to hook cleanup to cancellation | Truly unrelated background work with its own lifetime and deadline — `Background()` is honest there. `WithoutCancel` keeps values, so do not use it to escape a deadline you should respect |
| `for i := 0; i < b.N; i++ { … }` plus `runtime.KeepAlive` dances | `for b.Loop() { … }` (**1.24**) — handles timer scoping and keeps args alive; no longer blocks inlining as of 1.26 | Benchmarks that must control setup/teardown per iteration with `b.StopTimer`/`b.StartTimer`, or that need `b.N` itself for amortized reporting |
| `rand.Seed(time.Now().UnixNano())`, `rand.Intn` | `math/rand/v2` (**1.22**): auto-seeded, `rand.IntN`, `rand.N`, better generators. `rand.Seed` is deprecated in v1 | Reproducible test fixtures — then seed *explicitly* via `rand.New(rand.NewPCG(a, b))`, not the global. Cryptographic use: `crypto/rand`, never either |
| `if s != "" { v = s } else if t != "" { v = t } else { v = "default" }` | `cmp.Or(s, t, "default")` (**1.22**) | Fallbacks with side effects or expensive computation — `cmp.Or` evaluates all arguments |
| `json:"x,omitempty"` on structs, `time.Time`, or `0`-is-meaningful fields | `json:"x,omitzero"` (**1.24**) — honors `IsZero()`, drops zero `time.Time`, and does not swallow a meaningful `false`/`0` | Wire compatibility with a consumer that expects `omitempty`'s exact behavior (empty slice/map elision). `omitzero` keeps `[]T{}`; `omitempty` drops it |
| `time.Sleep` in concurrency tests, or polling with a timeout | `testing/synctest` (**1.25**, experimental in 1.24) — fake clock, deterministic goroutine quiescence | Integration tests crossing a real network or process boundary, where the fake clock does not apply |

## Not Yet — Do Not Reach For These

- **`encoding/json/v2` / `encoding/json/jsontext`** — still behind
  `GOEXPERIMENT=jsonv2` in Go 1.26, not covered by the compatibility promise.
  Trajectory points at 1.27 for default. Do not introduce it into production
  code or suggest it in review yet.
- **`simd/archsimd`, `runtime/secret`** (1.26) — experimental, arch-limited.

## Let The Toolchain Do The Rewrite

`go fix` in **1.26** absorbed the modernizers (previously `gopls`
`modernize`): it mechanically applies most of the table above — `min`/`max`,
`slices`/`maps` helpers, `b.Loop`, `any`, range-over-int, and more.

```sh
go fix ./...      # 1.26+: applies modernizers, not just the old API rewrites
go vet ./...
```

Run it before hand-editing. Reserve review attention for the judgment rows —
generics vs interfaces, `errors.Join` vs `%w`, iterator vs channel — which no
fixer can decide.

## Common Mistakes

- **Rewriting `v := v` out of a module declaring `go 1.21` or lower.** The
  1.22 semantics key off the `go` directive, not the installed toolchain. This
  is a data race, not a cleanup.
- **`maps.Keys` treated as returning a slice.** It returns `iter.Seq[K]`; wrap
  with `slices.Collect`, and `slices.Sorted` if order matters (map order is
  random, and tests that pass locally will flake in CI).
- **Returning `iter.Seq` for something that can fail.** Use `iter.Seq2[T, error]`
  or keep a separate `Err()` — silently ending the sequence hides errors.
- **`slog` with `fmt.Sprintf` inside the message.** That re-creates the problem
  slog solves; put the values in attrs.
- **`errors.Join` on nil-heavy paths.** It returns nil only if every argument
  is nil — fine, but do not assume the result is a single error when
  unwrapping; `errors.Is`/`errors.As` traverse it, manual `Unwrap()` does not.
- **Generic constraint written as `any` and then type-switched inside.** If the
  body branches on the type, the type parameter buys nothing.

## Related

- `golang-patterns` — idiomatic structure, concurrency, error conventions
- `golang-testing` — table-driven tests, subtests, fuzzing
