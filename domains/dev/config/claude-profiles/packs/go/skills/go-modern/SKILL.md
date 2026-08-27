---
name: go-modern
description: Use when writing or reviewing Go code and a pre-1.21 idiom shows up — `v := v` loop-variable copies, hand-rolled contains/keys/sort helpers, `if a > b` min/max, `log.Printf` for structured output, channel or callback iteration, `math/rand.Seed`, `for i := 0; i < b.N; i++` benchmarks, `interface{}`/reflection where generics fit, or `omitempty` on structs and time.Time. Maps each to the current stdlib or language form and says when the old form is still correct.
metadata:
  verified: 2026-08
---

# Modern Go

## Overview

Go 1.27 (Aug 2026, current release 1.27.0) and Go 1.26 are the supported
releases; Go 1.25 reached end of life the moment 1.27 shipped. Models write
Go as if 1.19 were current: manual slice helpers, `log.Printf`, `v := v`,
`interface{}` everywhere. Each has a current form — but several have a
legitimate "still correct" case, which is the point of the third column.

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
| `func ptr[T any](v T) *T { return &v }` helper, or a throwaway var solely to take its address (`x := computeDefault(); return &x`) | `new(expr)` (**1.26**) — `new`'s operand may now be an arbitrary expression, e.g. `return new(computeDefault())` | The value needs further mutation before its address escapes — `new(expr)` evaluates and takes the address in one step, no room for an intermediate assignment |
| Passing a seeded `io.Reader` as the `rand` argument to `rsa.GenerateKey`, `ecdsa.GenerateKey`, `ed25519.GenerateKey`, `rsa.SignPSS`, etc. for deterministic tests | `testing/cryptotest.SetGlobalRandom` (**1.26**) — these functions now ignore their `rand` parameter and always use a secure source; swap the global source for the test instead | Never for the old call signature going forward. The `GODEBUG=cryptocustomrand=1` setting restores 1.25 behavior temporarily — treat it as a migration bridge, not a permanent workaround |
| Package-scope generic function that exists only to attach behavior to one type, e.g. `func RandN[T any](r *rand.Rand, n T) T` | Generic method (**1.27**): `func (r *Rand) N[T any](n T) T` — a method may now declare its own type parameters | The function is genuinely type-agnostic across many receiver types, or turning it into a method would break an already-public API |
| Hand-rolled `json.NewDecoder(...).Token()` loops to stream large JSON without buffering it whole | `encoding/json/jsontext` (**1.27**, out of `GOEXPERIMENT=jsonv2` and covered by the compatibility promise) — `jsontext.Decoder`/`Encoder` work over a token/value stream with the same state-machine guarantees | A plain full-document unmarshal into a struct — `encoding/json.Unmarshal` (now v2-backed by default) is still the right default; reach for `jsontext` only when streaming or low-level token control is the actual requirement |
| Vendoring `google/uuid`, or hand-rolling RFC 9562 byte-twiddling for request/entity IDs | stdlib `uuid` package (**1.27**): `uuid.New()` / `uuid.NewV7()` / `uuid.Parse` | The project already depends on a third-party UUID library for a feature the stdlib subset doesn't cover — check `go doc uuid` on the pinned toolchain before ripping it out, and never migrate if `go.mod` targets `go 1.26` or lower (the package didn't exist yet) |
| `defer func() { io.Copy(io.Discard, resp.Body); resp.Body.Close() }()` to keep an HTTP/1 connection reusable | Nothing — since **1.27**, `Response.Body.Close()` auto-drains unread content (up to a conservative internal limit) before closing | Bodies that can be arbitrarily large, or non-HTTP/1 traffic — verify the limit with `go doc net/http.Response` on the pinned toolchain before deleting the explicit drain |
| Code that sets `GODEBUG=asynctimerchan=1`, or that assumes a `time.Timer`/`time.Ticker` channel can hold a buffered tick | Nothing to write — since **1.27** `time` channels are always unbuffered; the GODEBUG setting is removed outright and `go build`/`go test` error if it's still pinned to the old value in `go.mod`/`//go:debug` | Never — this is a runtime-enforced removal, not a style choice. Flag any lingering `asynctimerchan` reference for deletion |

## Newer Toolchain Behavior — No Rewrite, Just Awareness

These changed defaults affect what code *does* or what tooling *catches*,
not how it should be written. Do not propose a diff for these — just know
they're active on 1.26/1.27:

- **Green Tea GC is the default GC since 1.26** — expect roughly 10-40% lower
  GC overhead on allocation-heavy programs, more on newer amd64 CPUs
  (Ice Lake / Zen 4+). No code change; `GOEXPERIMENT=nogreenteagc` opts out.
- **`goroutineleak` pprof profile is GA since 1.27** — `runtime/pprof` and the
  `/debug/pprof/goroutineleak` HTTP endpoint report goroutines blocked on a
  primitive (channel, `sync.Mutex`, `sync.Cond`, ...) that can never unblock.
  Concurrency-correctness judgment (is this actually a leak, and what's the
  fix) belongs to `go-perf-reviewer`/`go-concurrency`, not this skill.
- **`go test` runs the stdversion vet check by default since 1.27** — it
  flags stdlib symbols too new for the `go` directive/build tags of the file
  that uses them. This catches "used a 1.27 API in a file gated to `go
  1.24`" automatically; no manual `go vet -stdversion` invocation needed.

## Not Yet — Do Not Reach For These

- **`simd`, `simd/archsimd`, `runtime/secret`** (1.26/1.27) — experimental,
  arch-limited, behind `GOEXPERIMENT`. Do not introduce into production code
  or suggest in review yet.

## Deterministic First: `go fix ./...`

`go fix` in **1.26** absorbed the modernizer suite (previously `gopls`'s
separate `modernize` analysis, plus a source-level inliner driven by
`//go:fix inline` directives). It mechanically applies most of the table
above — run it before any hand-editing, and reserve review attention for the
judgment rows (generics vs interfaces, `errors.Join` vs `%w`, iterator vs
channel, package vs method) that no fixer can decide.

```sh
go fix ./...        # 1.26+: runs every modernizer plus the historical fixers
go fix -diff ./...  # preview the rewrite without writing it
go fix -any ./...   # run one named modernizer only (substitute the name)
go tool fix help    # list fixers available on the installed toolchain
go vet ./...
```

Modernizers present as of **1.27** — treat this as a snapshot, not a
guarantee; confirm the live list with `go tool fix help` on the pinned
toolchain before relying on a name:
`any`, `atomictypes` (new in 1.27), `bloop`, `embedlit` (new in 1.27),
`errorsastype`, `forvar`, `hostport`, `importcomment`, `inline`, `mapsloop`,
`minmax`, `newexpr`, `omitzero`, `rangeint`, `reflecttypefor`,
`slicesbackward` (new in 1.27), `slicesclip`, `slicescontains`,
`slicesdelete`, `slicessort`, `stditerators`, `stringsbuilder`,
`stringscut`, `stringscutprefix`, `stringsseq`, `unsafefuncs` (new in 1.27),
`waitgroupgo` (renamed from `waitgroup` in 1.27). `fmtappendf` was removed in
1.27 for stylistic reasons — do not expect it on a 1.27+ toolchain.

For a module still pinned below `go 1.26` (older toolchain, or CI running an
older Go), run the standalone modernizer instead of `go fix`:

```sh
go run golang.org/x/tools/go/analysis/passes/modernize/cmd/modernize@latest -fix ./...
```

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
- **Assuming `encoding/json` still tolerates invalid UTF-8 and duplicate
  object keys.** Since 1.27 the package is v2-backed by default and rejects
  both — data that unmarshaled quietly before can now error. Check `go doc`
  on the pinned toolchain before assuming old leniency.

## Related

- `golang-patterns` — idiomatic structure, concurrency, error conventions
- `golang-testing` — table-driven tests, subtests, fuzzing
