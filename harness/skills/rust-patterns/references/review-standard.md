# Rust review standard

The one Rust standard for both the model writing Rust and `code-reviewer`
reviewing a Rust diff. It lists what to check and where the rule comes from;
detail and code live in the skills it links: `rust-patterns` (ownership,
errors, enums, traits, crate layout, security examples) and `rust-testing`
(unit, integration, async, property, mock, coverage, benchmarks).

Before applying any rule, read `edition` and `rust-version` (the MSRV) in
`Cargo.toml`, the `[profile.release]` table, the `[lints]` table, and which
async runtime the crate depends on. A rule gated on a version or edition
does not apply below it. Confirm an API exists at the MSRV from docs.rs or
doc.rust-lang.org at that version; never from memory and never by compiling.

Sources are cited by the short name in the first column of section 1.
Clippy lints are cited as `clippy::<name> (group)`; each has its page at
`https://clippy.rust-lang.org/master/index.html#<name>`.

## 1. Sources

| Short | Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|---|
| API | Rust API Guidelines (checklist and chapters) | https://rust-lang.github.io/api-guidelines/checklist.html | Naming, conversions, common traits, errors, `Send`/`Sync`, docs, caller control, sealed traits, destructors | Last repository commit 2025-07-08; content largely older, no date on the pages | MIT OR Apache-2.0 |
| CLP | Clippy lint list | https://clippy.rust-lang.org/master/index.html | Per-lint group, level, rationale | master (lints added through 1.99); groups checked in rust-clippy source at commit 625570028, 2026-10-17 | MIT OR Apache-2.0 |
| CLG | Clippy book: lint groups | https://doc.rust-lang.org/clippy/lints.html | What each group means; never enable `restriction` or `nursery` wholesale | master | MIT OR Apache-2.0 |
| RLINT | rustc lint listing | https://doc.rust-lang.org/rustc/lints/listing/index.html | allowed / warn / deny by default | Tracks stable 1.99 | MIT OR Apache-2.0 |
| REF | The Rust Reference: Behavior considered undefined; Diagnostics attributes; `non_exhaustive`; Procedural macros | https://doc.rust-lang.org/reference/behavior-considered-undefined.html, https://doc.rust-lang.org/reference/attributes/diagnostics.html, https://doc.rust-lang.org/reference/attributes/type_system.html, https://doc.rust-lang.org/reference/procedural-macros.html | UB list (stated non-exhaustive), `#[must_use]`, lint levels and `reason`, `#[expect]`, proc macros run in the compiler | Repository pushed 2026-10-13 | MIT OR Apache-2.0 |
| NOM | The Rustonomicon: intro, Send and Sync, Data Races, Working with Unsafe, Exception Safety | https://doc.rust-lang.org/nomicon/ (pages `send-and-sync.html`, `races.html`, `working-with-unsafe.html`, `exception-safety.html`) | Unsafe soundness, privacy boundary, `Send`/`Sync`, races vs data races, panic safety | Says "This book is incomplete"; Send and Sync page carries an open TODO. The Reference wins where they disagree | MIT OR Apache-2.0 |
| STD | Standard library docs: `keyword.unsafe`, `sync::Mutex`, `sync::atomic`, `thread::scope` | https://doc.rust-lang.org/std/keyword.unsafe.html, https://doc.rust-lang.org/std/sync/struct.Mutex.html, https://doc.rust-lang.org/std/sync/atomic/index.html, https://doc.rust-lang.org/std/thread/fn.scope.html | `// SAFETY:` and `# Safety` conventions, poisoning, re-entrant locking, memory orderings | std 1.99.1 (2026-10-13) | MIT OR Apache-2.0 |
| BOOK | The Rust Programming Language: 9.3 To panic or not, 16.4 Send and Sync, 18.1 OO characteristics | https://doc.rust-lang.org/book/ch09-03-to-panic-or-not-to-panic.html, https://doc.rust-lang.org/book/ch16-04-extensible-concurrency-sync-and-send.html, https://doc.rust-lang.org/book/ch18-01-what-is-oo.html | Panic vs `Result`, `expect` with a reason, no struct inheritance | Current online edition | MIT OR Apache-2.0 |
| EDG | Edition Guide, Rust 2024 | https://doc.rust-lang.org/edition-guide/rust-2024/index.html (pages `unsafe-op-in-unsafe-fn`, `temporary-if-let-scope`, `temporary-tail-expr-scope`, `rpit-lifetime-capture`, `static-mut-references`) | Edition 2024 changes and migration | Edition 2024 shipped in 1.85.0 (2025-02-20) | MIT OR Apache-2.0 |
| REL | Rust release posts 1.75–1.99 | https://blog.rust-lang.org/releases/ (each post at `/YYYY/MM/DD/Rust-1.NN.0/`) | Version-gated language, library and lint changes | Latest stable 1.99.1 (2026-10-15) | MIT OR Apache-2.0 |
| CARGO | Cargo book: `[lints]`, build scripts | https://doc.rust-lang.org/cargo/reference/manifest.html#the-lints-section, https://doc.rust-lang.org/cargo/reference/build-scripts.html | Lint config in `Cargo.toml` (MSRV 1.74); `build.rs` is compiled and run before the package builds | Current | MIT OR Apache-2.0 |
| ER | Effective Rust (David Drysdale), items 4, 12, 15, 16, 17, 18, 29 | https://effective-rust.com/ (`errors.html`, `generics.html`, `borrows.html`, `unsafe.html`, `deadlock.html`, `panic.html`, `clippy.html`) | Error types, generics vs trait objects, borrow checker, unsafe, shared state, panics, Clippy | O'Reilly 2024. Item 12 says trait-object upcasting is impossible; stable since 1.86 | CC BY-NC-ND 4.0: cite by item, never copy |
| PERF | The Rust Performance Book (Nethercote et al.): Heap Allocations, Hashing, Iterators, Bounds Checks, Build Configuration, Benchmarking | https://nnethercote.github.io/perf-book/ (pages `heap-allocations.html`, `hashing.html`, `iterators.html`, `bounds-checks.html`, `build-configuration.html`, `benchmarking.html`) | Allocation, hasher choice, iterator shape, profile settings, benchmarking | First published 2020-11; repository pushed 2026-04-23 | MIT OR Apache-2.0 |
| TOK | Tokio docs: `task::spawn`, `task::spawn_blocking`, `sync::Mutex`, `sync::mpsc`, `sync::Semaphore`, `join!`; tutorial Shared state | https://docs.rs/tokio/latest/tokio/ (those items), https://tokio.rs/tokio/tutorial/shared-state | Blocking in async, mutex choice, guards across `.await`, bounded channels, concurrency limits | tokio 1.53.3 | MIT |
| ATR | async-trait crate docs | https://docs.rs/async-trait/latest/async_trait/ | Desugars to `Pin<Box<dyn Future + Send>>`; still needed for `dyn Trait` | 0.1.92 | MIT OR Apache-2.0 |
| MIRI | Miri | https://github.com/rust-lang/miri | UB detection in tests, limits (not all UB, no FFI, one execution) | Current | MIT OR Apache-2.0 |
| DENY | cargo-deny checks | https://embarkstudios.github.io/cargo-deny/checks/index.html | advisories, bans, licenses, sources | Current; version not shown | MIT OR Apache-2.0 |
| AUDIT | RustSec / cargo-audit | https://rustsec.org/ | Audits `Cargo.lock` against the RustSec advisory DB | Current | Not stated on the page |

## 2. Mindset

- Ownership is the design: decide who owns each value first; borrow when
  the function does not need to keep it (API C-CALLER-CONTROL, ER item 15).
- Make invalid states unrepresentable with enums and newtypes; validate at
  the boundary and let the type carry the proof (API C-NEWTYPE, C-VALIDATE).
- Fallible operations return `Result`; `panic!` means a bug or a broken
  invariant, not an expected failure (BOOK 9.3, ER item 18).
- `unsafe` asserts a contract the compiler cannot check; its soundness
  depends on every safe line in the same module (STD `keyword.unsafe`, NOM
  Working with Unsafe).
- Safe Rust rules out data races, not deadlocks or race conditions (NOM
  Data Races, ER item 17).
- Clippy and rustc warnings are fixed or allowed narrowly with a reason, not
  argued about (ER item 29, CLG).
- Performance claims need a hot path and a measurement; Rust's cost model is
  visible, but many "obvious" rewrites do not borrow-check (PERF).

## 3. Habits carried from other languages

| Habit | Do instead | Source |
|---|---|---|
| `clone()` or `Rc<RefCell<T>>` (a C++ shared-pointer translation) to get past the borrow checker | Restructure so one owner holds the data; smart pointers only for genuinely graph-shaped data | ER item 15 |
| Shared mutable state by default (`Arc<Mutex<T>>` everywhere) | Message passing or a task owning the state; one lock per invariant when sharing is needed | ER item 17, TOK Shared state |
| `String` or `()` as the error type | A type implementing `Error`; enum variants when callers need to tell causes apart | ER item 4, API C-GOOD-ERR |
| `panic!` + `catch_unwind` as try/catch (Java, C++) | Return `Result`; `catch_unwind` only at FFI boundaries; it does nothing under `panic = "abort"` | ER item 18 |
| Reading a trait bound as inheritance ("`Shape` is-a `Draw`") or expecting struct inheritance | Default trait methods for reuse; generics or trait objects for polymorphism; composition of fields | ER item 12, BOOK 18.1 |
| `get_name()` getters | `name()`; `get` only when there is one obvious value | API C-GETTER |
| Out-parameters (`fn f(out: &mut T)`) to return several values | Return a tuple or struct; `&mut` only to fill a caller-owned buffer | API C-NO-OUT |
| `static mut` globals | Atomics, `Mutex`, `LazyLock`, `OnceLock`; `&raw` pointers when a `static mut` must stay | EDG static-mut-references |

## 4. Review items

Format: `id` — trigger visible in a diff — what to check — why — source.
One-line items are general knowledge; detail appears only where judgment or
a threshold is involved. A finding names the concrete failure; "might be
wrong" is not a finding.

### 4.1 Correctness and ownership

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| rs-unwrap-prod | `.unwrap()`, `.expect()`, indexing `v[i]`, `/` on a divisor from input, in a non-test path | Return the error with `?`. `expect("reason")` is right where the code proves `Err`/`None` cannot happen, and the message states that proof. `lock().unwrap()` is the std-documented default (see rs-mutex-poison) | Hidden panics in production paths | BOOK 9.3, ER item 18, `clippy::unwrap_used`, `expect_used`, `indexing_slicing` (restriction) |
| rs-panic-macro | `todo!()`, `unimplemented!()`, `panic!()` added on a reachable path | Replace with an error; `unreachable!()` only with the invariant stated | Callers cannot recover | `clippy::todo`, `unimplemented`, `panic` (restriction), BOOK 9.3 |
| rs-must-use-dropped | `let _ = f();` or a bare call on a `Result`, future or `#[must_use]` value | Handle it, or comment why dropping is safe | Lost errors; a dropped future never runs | REF diagnostics `must_use`, `clippy::let_underscore_must_use` (restriction), `let_underscore_future` (suspicious) |
| rs-let-underscore-guard | `let _ = mutex.lock()` or `let _ = guard_returning_call()` | Bind to `_guard` | `let _` drops the guard immediately | RLINT `let_underscore_lock` (deny) |
| rs-wildcard-enum | `_ =>` arm on an enum the crate owns, in business logic | List the variants so a new one fails to compile; a wildcard is required for a foreign `#[non_exhaustive]` enum | New variants silently take the default path | `clippy::wildcard_enum_match_arm` (restriction), `match_wildcard_for_single_variants` (pedantic), REF `non_exhaustive` |
| rs-temp-scope | `if let` or a block tail expression whose temporary is a lock guard or `RefCell` borrow | Check the edition: 2024 drops `if let` scrutinee temporaries before `else` and tail temporaries before locals; 2021 keeps them, which can deadlock (`read()` in `if let`, `write()` in `else`) | Behaviour differs by edition | EDG temporary-if-let-scope, temporary-tail-expr-scope |
| rs-clone-for-borrowck | `.clone()`/`.to_owned()` added next to a borrow error fix | Is ownership actually needed? Prefer borrowing, `std::mem::take`, or restructuring. Cloning small immutable data is acceptable; flag it only with a reason (a hot path, or copies that must stay in sync) | Copies diverge; cost on hot paths | ER item 15, `clippy::redundant_clone` (nursery) |
| rs-borrow-params | `&String`, `&Vec<T>`, `&PathBuf`, or an owned `String`/`Vec` parameter that is only read | `&str`, `&[T]`, `&Path`; take ownership only to store or consume | Forces callers to allocate or clone | API C-CALLER-CONTROL, `clippy::ptr_arg` (style), `needless_pass_by_value` (pedantic) |
| rs-lifetimes | Explicit lifetimes elision would infer; a signature mixing elided and named forms for one lifetime | Drop the annotations; keep forms consistent | Noise; 1.89 warns on mismatched forms | `clippy::needless_lifetimes` (complexity), RLINT `mismatched_lifetime_syntaxes` (warn) |
| rs-rpit-capture | Return-position `impl Trait` in a crate moving to edition 2024 | 2024 captures all in-scope lifetimes; add `use<..>` when callers hit lifetime errors from overcapturing | Signature meaning changes with the edition | EDG rpit-lifetime-capture |
| rs-sort-ord | Hand-written `Ord`/`PartialOrd` | Consistent with `Eq` and transitive | Since 1.81 sort may panic on an inconsistent `Ord` | REL 1.81 |
| rs-mut-key | `HashMap`/`HashSet` key with interior mutability | Key hash and equality cannot change while stored | Lookups silently fail | `clippy::mutable_key_type` (suspicious) |

### 4.2 Errors

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| rs-err-type | New public `Result<_, String>`, `Result<_, ()>`, or `Box<dyn Error>` in a library API | A concrete error type implementing `Error + Send + Sync + 'static` (enum when callers branch on causes; `thiserror` derives it). Applications may use `anyhow`; libraries must not expose it | Callers cannot match or propagate the error well | API C-GOOD-ERR, ER item 4, `clippy::result_unit_err` (style) |
| rs-err-source | `.map_err(\|_\| …)` discarding the cause; wrapper error without `source()` | Keep the original as `source` (`#[from]`/`#[source]` in thiserror) | Lost diagnosis chain | `clippy::map_err_ignore` (restriction), ER item 4 |
| rs-err-display | Error `Display` text capitalised or with trailing punctuation | lowercase, concise, no trailing punctuation | Messages get chained | API C-GOOD-ERR |
| rs-err-doc | Public fallible or panicking fn without `# Errors` / `# Panics` | Add the section | Callers need the failure contract | API C-FAILURE, `clippy::missing_errors_doc`, `missing_panics_doc` (pedantic) |
| rs-drop-fallible | `Drop` impl that can fail or block (flush, network close) | Provide `close() -> Result`; `Drop` ignores or logs errors | A failure during unwinding aborts | API C-DTOR-FAIL, C-DTOR-BLOCK |
| rs-ffi-unwind | `extern "C"` fn that can panic, or Rust called from C that can unwind | Catch at the boundary or use `"C-unwind"` | Since 1.81 unwinding out of `"C"` aborts | REL 1.81, ER item 18 |

### 4.3 Unsafe

The UB list (REF) is explicitly non-exhaustive, and the Nomicon is
incomplete; when in doubt, the code is not sound until the author shows the
argument. Soundness findings need the invariant that breaks and the
safe-code path that breaks it.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| rs-unsafe-safety-comment | New `unsafe {}` block or `unsafe impl` | A `// SAFETY:` comment naming each precondition and why it holds here | The block asserts a contract; the reader must be able to check it | STD `keyword.unsafe`, `clippy::undocumented_unsafe_blocks` (restriction) |
| rs-unsafe-fn-doc | New `pub unsafe fn` or `unsafe trait` | `# Safety` section listing every caller obligation | Callers cannot uphold an unstated contract | API C-FAILURE, `clippy::missing_safety_doc` (style) |
| rs-unsafe-op-in-fn | Unsafe operations in an `unsafe fn` body without an inner block | Wrap each in `unsafe {}` with its own comment (default warning in 2024) | Separates "caller must" from "I checked" | EDG unsafe-op-in-unsafe-fn, ER item 16 |
| rs-unsafe-scope | Large `unsafe` block, or unsafe used for convenience or to bypass the borrow checker | One operation per block where practical; first look for a std or crates.io safe API | Smaller surface to argue about | ER item 16, `clippy::multiple_unsafe_ops_per_block` (restriction) |
| rs-unsafe-module-invariant | Safe code changed in a module that contains `unsafe` (length, capacity, index fields) | Re-check every `unsafe` block that relies on the changed state; keep those fields private | Safe edits can make the unsafe code unsound | NOM Working with Unsafe |
| rs-unsafe-panic-safety | `unsafe` code that calls user code (`clone`, `Ord`, closures) while an invariant is temporarily broken | Set lengths after writes, or use a drop guard that restores state | A panic exposes uninitialised or doubled values | NOM Exception Safety |
| rs-ub-list | Raw pointer deref, `transmute`, `MaybeUninit::assume_init`, `set_len`, `&T` → `&mut T` | Against the UB list: aliasing, alignment, dangling, invalid values (`bool`, `char`, enum discriminants), uninitialised integers | UB, not a crash | REF behavior-considered-undefined, `clippy::mut_from_ref`, `uninit_vec` (correctness), RLINT `invalid_reference_casting`, `mutable_transmutes` (deny) |
| rs-static-mut | `&STATIC_MUT` or `&mut STATIC_MUT`, including implicit (`.len()`, `println!`) | Replace with atomics, `Mutex`, `LazyLock`, `OnceLock`, or `&raw` | Instant UB on aliasing; deny by default in 2024 | EDG static-mut-references, RLINT `static_mut_refs` |
| rs-unsafe-send-sync | `unsafe impl Send` / `Sync`, or a raw pointer field in a type that must be thread-safe | State why cross-thread use is sound; generic wrappers bound `T: Send` / `T: Sync`; add a compile-time assertion test | Wrong impls are UB in other safe code | NOM Send and Sync, API C-SEND-SYNC, `clippy::non_send_fields_in_send_ty` (nursery) |
| rs-unsafe-test | New or changed `unsafe` | Name `cargo +nightly miri test` for the affected tests; Miri cannot run FFI or networking, and a clean run is not proof | Catches UB the compiler cannot see | MIRI, ER item 16 |

### 4.4 Concurrency and async

Correctness here; cost of contention is 4.5. Model: section 6.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| rs-guard-across-await | `std::sync::MutexGuard`, `RwLock` guard or `RefCell` borrow alive at an `.await` | Scope the guard in a block that ends before the `.await` (`drop()` does not satisfy the `Send` check); use `tokio::sync::Mutex` only when the lock must span the `.await` | Deadlock, or a non-`Send` future that cannot be spawned | TOK Shared state, `sync::Mutex`, `clippy::await_holding_lock`, `await_holding_refcell_ref` (suspicious) |
| rs-blocking-in-async | `std::fs`, `std::net`, `std::thread::sleep`, blocking client or DB driver, or long CPU loop inside `async fn` | Async API, or `spawn_blocking` for short bounded work; a dedicated thread or rayon for long or CPU-heavy work | Stalls every task on that worker | TOK `spawn_blocking` |
| rs-lock-order | Two or more locks taken in one path; a closure or callback invoked while holding a lock; a `MutexGuard` returned to callers | One consistent order; keep related data under one lock; never call out while locked | Deadlock (safe Rust allows it) | ER item 17, NOM Data Races |
| rs-relock | Same `Mutex` locked twice on one thread (helper called while locked) | Restructure | Unspecified: may panic or deadlock | STD `Mutex::lock`, `clippy::if_let_mutex` (correctness) |
| rs-mutex-poison | `lock()` result handling | `.unwrap()` propagating the panic is the documented default. Flag `into_inner()` recovery without restoring the invariant, and any `unsafe` relying on poisoning | Poisoning is advisory and not guaranteed | STD `Mutex` |
| rs-unbounded-channel | `mpsc::channel()` (std, unbounded), `tokio::sync::mpsc::unbounded_channel` between a fast producer and a slower consumer | Bounded channel (`sync_channel(n)`, `mpsc::channel(n)`) unless the producer rate is bounded by design, stated in a comment | No backpressure; memory grows with backlog | TOK `sync::mpsc` |
| rs-unbounded-spawn | `tokio::spawn` or `thread::spawn` per item of a data-sized collection | Limit with `Semaphore` or a bounded `JoinSet` loop | Resource use grows with input | TOK `Semaphore`, `spawn` |
| rs-detached-task | `tokio::spawn` whose `JoinHandle` is dropped; work that must finish before shutdown | Keep and await the handle or a `JoinSet`; spawned tasks may be dropped at runtime shutdown | Silent loss of work and panics | TOK `spawn` |
| rs-atomic-ordering | New atomics, especially `Relaxed` used to publish data, or two atomics forming one check-then-act | `Release` store / `Acquire` load to publish; a mutex for multi-variable invariants | Stale reads; race conditions | STD `sync::atomic`, NOM Data Races |
| rs-async-trait-send | `async fn` in a public trait used with `tokio::spawn` or generic code | Declare `fn m(&self) -> impl Future<Output = T> + Send`, or suppress the lint when the trait is local or single-threaded | Callers cannot rely on the future being `Send` | RLINT `async_fn_in_trait` (warn) |
| rs-arc-non-send | `Arc<T>` where `T` is not `Send + Sync`; `Rc<Mutex<T>>` | `Rc` for single-thread, `Arc<Mutex<T>>` for shared | Pays atomic cost with no thread safety, or the reverse | `clippy::arc_with_non_send_sync` (suspicious), `rc_mutex` (restriction) |

### 4.5 Performance

Report only on paths that run often (request path, loop over a data-sized
collection); say so when the code is cold and skip it. A clone in `main`, a
builder, CLI parsing or a test fixture is not a finding. Tag each finding
`static` (holds without measurement) or `needs-measurement`, and name the
command that would confirm it (`cargo bench` with criterion or divan in
release, a flamegraph, `cargo asm` for codegen claims). Never call a claim
verified without a before/after benchmark whose interval excludes noise and
a profile showing the named mechanism. Check `[profile.release]` before a
codegen finding.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| rs-alloc-in-loop | `Vec::new()`/`String::new()`/`format!` inside a hot loop body | Hoist the buffer, `clear()` per iteration; `write!` into a reused `String` | One allocation per iteration | PERF Heap Allocations, `clippy::format_push_string` (pedantic) |
| rs-with-capacity | `push` loop with a known or estimable final size | `with_capacity`/`reserve`; only when the size is known | Repeated regrowth | PERF Heap Allocations |
| rs-needless-collect | `collect()` into a collection that is iterated once, `.collect::<Vec<_>>().len()` | Chain the iterators; return `impl Iterator`; `extend` instead of collect + append | Allocation and an extra pass | PERF Iterators, `clippy::needless_collect` (nursery) |
| rs-to-owned | `.to_owned()`/`.to_string()`/`.cloned()` before an operation that only reads | Borrow; `Cow` when only some paths allocate; `clone_from` to reuse a buffer | Allocation per call | PERF Heap Allocations, `clippy::unnecessary_to_owned`, `iter_overeager_cloned` (perf) |
| rs-large-variant | Enum with one large variant; `Result<T, E>` with a large `E` | Box the large variant or error | Every value pays the largest size | `clippy::large_enum_variant`, `result_large_err` (perf) |
| rs-box-collection | `Box<Vec<T>>`, `Box<String>`, `Vec<Box<T>>` for sized `T`, `Rc<Box<T>>` | Drop the extra indirection | Double allocation and pointer chase | `clippy::box_collection`, `redundant_allocation` (perf), `vec_box` (complexity) |
| rs-hasher | Default `HashMap` in a measured hot path with small keys | `rustc-hash`/`ahash`/`fnv` only for keys an attacker cannot choose; needs-measurement | SipHash 1-3 resists HashDoS and is slow on short keys | PERF Hashing |
| rs-dyn-closed-set | `Box<dyn Trait>` in a hot loop over a closed, known set of types | Generic parameter or enum; needs-measurement (vtable cost is rarely significant unmeasured). The reverse (monomorphisation bloat) needs a code-size number | Blocks inlining | ER item 12, API C-OBJECT |
| rs-async-trait-box | `#[async_trait]` on a trait called in a hot path, MSRV ≥ 1.75, no `dyn` use | Native `async fn` or `-> impl Future`; keep the macro when `dyn Trait` is needed | One `Box::pin` per call | ATR, REL 1.75 |
| rs-lock-scope | Guard held across I/O, allocation or long compute on a hot path | Copy out what is needed, end the guard's scope, then do the slow part | Serialises work | TOK Shared state, ER item 17, `clippy::significant_drop_tightening` (nursery) |
| rs-mutex-counter | `Mutex<bool>`/`Mutex<usize>` guarding a single value | Atomic with a named ordering; keep the mutex for multi-field invariants | Lock overhead | `clippy::mutex_atomic`, `mutex_integer` (restriction), STD `sync::atomic` |
| rs-global-lock | One `Mutex<HashMap>` behind a per-key workload under contention | Shard by key hash (or `dashmap`), or a task owning the map; needs-measurement | Contention blocks other tasks on the thread | TOK Shared state |
| rs-serial-await | `for x in xs { f(x).await }` over independent futures | `join!`/`try_join!` for a fixed set, `JoinSet` for a dynamic set, bounded (rs-unbounded-spawn) | Latency adds up | TOK `join!`, `spawn` |
| rs-index-loop | `for i in 0..v.len() { v[i] … }` in a hot loop; `chunks` where the size divides evenly | Iterate, `zip`, `chunks_exact`; slice before the loop. Vectorisation claims are always needs-measurement with `cargo asm` | Bounds checks; gains usually modest | PERF Bounds Checks, Iterators, `clippy::needless_range_loop` (style), `manual_memcpy` (perf) |
| rs-build-profile | Codegen finding on a crate with default `[profile.release]` | Consider `lto = "thin"`, `codegen-units = 1`, `panic = "abort"`, PGO before a source rewrite; say so | Often a larger, cheaper win | PERF Build Configuration |

### 4.6 API design

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| rs-common-traits | New public type | Derive or implement `Debug` (non-empty), `Clone`, `PartialEq`/`Eq`, `Hash`, `Default` where they make sense | Downstream crates cannot add them (orphan rule) | API C-COMMON-TRAITS, C-DEBUG |
| rs-from-not-into | `impl Into<X> for Y` | `impl From<Y> for X` (and `TryFrom`) | Blanket impl gives `Into` | API C-CONV-TRAITS, `clippy::from_over_into` (style) |
| rs-struct-private | New `pub` fields on a type with invariants | Private fields plus accessors; public fields only for passive data | Locks the representation | API C-STRUCT-PRIVATE |
| rs-non-exhaustive | Public enum or struct expected to grow | `#[non_exhaustive]`, accepting that downstream must use `_` / `..` | Adding a variant is otherwise breaking | REF `non_exhaustive` |
| rs-sealed | Public trait not meant for downstream impls | Seal it with a private supertrait and document it | Adding methods stays non-breaking | API C-SEALED |
| rs-newtype | Several same-typed primitive parameters (`u64, u64`), `bool` flags | Newtypes or enums | Swapped arguments compile | API C-NEWTYPE, C-CUSTOM-TYPE |
| rs-object-safety | Trait meant for `dyn` gains a generic method or `Self` return | `where Self: Sized` on that method, or decide generic-only | Breaks existing trait objects | API C-OBJECT |
| rs-must-use-attr | New fn returning a value whose discard is a bug (builder, guard, pure computation) | `#[must_use]` with a message | Turns silent misuse into a warning | REF diagnostics `must_use` |
| rs-visibility | New `pub` item used only in the crate | `pub(crate)` or private | Smaller API to keep stable | `rust-patterns` "Visibility", RLINT `unreachable_pub` (allow) |
| rs-public-dep | Public API exposes a dependency's type | The dependency is stable and re-exported | Its major bump becomes yours | API C-STABLE, ER item 24 |

### 4.7 Naming and readability

One line each; `clippy::style` catches several.

| id | Trigger | Check | Source |
|---|---|---|---|
| rs-case | `HTTPClient`, `getUser`, `maxSize` const | `HttpClient` (acronym as one word), `snake_case` fns, `SCREAMING_SNAKE_CASE` consts | API C-CASE, RLINT `non_snake_case` |
| rs-conv-names | `as_`/`to_`/`into_` names that do not match cost and ownership | `as_` free borrow, `to_` costly, `into_` consumes | API C-CONV, `clippy::wrong_self_convention` (style) |
| rs-getter | `get_foo()` | `foo()` / `foo_mut()` | API C-GETTER |
| rs-iter-names | Collection iterator methods with other names | `iter`, `iter_mut`, `into_iter` returning `Iter`, `IterMut`, `IntoIter` | API C-ITER |
| rs-ctor | Constructor as a free function, `new()` without `Default` | Inherent `new`; implement `Default` too when it takes no arguments | API C-CTOR, `clippy::new_without_default` (style) |
| rs-question-mark | `match r { Ok(v) => v, Err(e) => return Err(e.into()) }` | `?` | `clippy::question_mark` (style) |
| rs-allow-reason | New `#[allow(clippy::…)]` or `#![allow]` | Narrowest scope, `reason = "…"`; prefer `#[expect]` (1.81) so a stale allow is reported | REF diagnostics, REL 1.81, ER item 29, `clippy::allow_attributes_without_reason` (restriction) |
| rs-pub-docs | Public item without `///` docs; examples using `unwrap` | Document; examples use `?` with a hidden `main` | API C-CRATE-DOC, C-QUESTION-MARK, RLINT `missing_docs` (allow) |

### 4.8 Testing

Patterns and examples: `rust-testing`. `test-reviewer` owns whether tests
protect behaviour; these are Rust-specific forms.

| id | Trigger | Check | Source |
|---|---|---|---|
| rs-test-result-assert | `assert!(r.is_ok())` / `assert!(r.is_err())` | `r.unwrap()` / `unwrap_err()`, or `assert_matches!` (1.96) on the variant, so the failure prints the value | `clippy::assertions_on_result_states` (restriction), REL 1.96 |
| rs-test-unwrap | Reviewer flags `unwrap` in tests | Not a finding: tests may panic to fail | BOOK 9.3 |
| rs-test-should-panic | `#[should_panic]` without `expected = "…"`, or on a fallible API | Add the message, or test the `Err` | `rust-testing` "Testing Panics" |
| rs-test-send-sync | Public type whose `Send`/`Sync` matters | Compile-time assertion test | API C-SEND-SYNC |
| rs-test-unsafe | `unsafe` without tests that exercise its edge cases | Add them and run under Miri | MIRI, ER item 16 |
| rs-test-bench | New benchmark run in debug, or a hand-rolled timing loop | criterion or divan, release profile | PERF Benchmarking |
| rs-test-sleep | `sleep` to wait for tasks or threads | Channels, barriers, or a paused tokio clock | `rust-testing` "Best Practices" |

## 5. Version-gated modern features

Suggest only when `rust-version` (or, if absent, the toolchain CI pins) is
at or above the version; edition-gated forms also need that `edition`.
Sources: REL per version, EDG for 2024.

| Version | Suggest | Old form still right when |
|---|---|---|
| 1.63 | `std::thread::scope` to borrow locals in threads | Threads must outlive the function |
| 1.70 | `OnceCell`/`OnceLock` | — |
| 1.74 | `[lints]` table in `Cargo.toml` (and workspace) | Lint config that differs per target or module stays in attributes |
| 1.75 | `async fn` and `-> impl Trait` in traits | `dyn Trait` with async methods (keep `async-trait`); public traits that must promise `Send` use `-> impl Future + Send` |
| 1.77 | `Mutex::clear_poison` after repairing data | — |
| 1.80 | `LazyLock`/`LazyCell` instead of `lazy_static`/`once_cell`; exclusive range patterns | Initialisation needs runtime input set once (`OnceLock`) |
| 1.81 | `#[expect(lint, reason = "…")]`; `core::error::Error` for `no_std`; `"C-unwind"` where panics cross FFI | `#[allow]` when the lint fires only on some targets or features |
| 1.82 | `&raw const`/`&raw mut` instead of `addr_of!`; `use<..>` precise capturing; `unsafe extern` with `safe` items; `#[unsafe(no_mangle)]`; `Option::is_none_or`; `Box::new_uninit` | — |
| 1.85 | Edition 2024 (below); async closures (`async \|\| {}`, `AsyncFn*`) | Crates whose MSRV is below 1.85 stay on 2021 |
| 1.86 | Trait upcasting (`&dyn Sub` → `&dyn Super`); `get_disjoint_mut` | — |
| 1.88 | Let chains in `if`/`while` (edition 2024 only) | Edition 2021 crates |
| 1.89 | `File::lock` family; `Result::flatten`; `_` for inferred const generic args | — |
| 1.91 | `strict_*` integer arithmetic; `Duration::from_mins`/`from_hours` | `checked_*`/`wrapping_*` where overflow is an expected case |
| 1.92 | `RwLockWriteGuard::downgrade`; `Box`/`Rc`/`Arc::new_zeroed` | — |
| 1.93 | `std::fmt::from_fn` for ad-hoc `Display` | A named type when the formatter is reused |
| 1.95 | `cfg_select!` instead of `cfg-if`; `if let` guards in `match`; atomic `update`/`try_update` | — |
| 1.96 | `assert_matches!`/`debug_assert_matches!` (import from `std`/`core`) | — |
| 1.98 | Integer `format_into` with `NumBuffer` for allocation-free formatting | — |
| 1.99 | `Vec::into_parts`/`from_parts`, `Box::into_non_null`/`from_non_null`; C-variadic `extern "C"` definitions | — |

**Edition 2024** (1.85): `unsafe_op_in_unsafe_fn` warns; `extern` blocks
need `unsafe`; `no_mangle`/`export_name` need `#[unsafe(...)]`; RPIT captures
all in-scope lifetimes; `if let` and tail-expression temporaries drop
earlier; `static_mut_refs` is deny; `!` fallback changes; `gen` is reserved;
`Box<[T]>::into_iter` yields values; `Future`/`IntoFuture` in the prelude;
MSRV-aware resolver. Verified on their EDG pages: `unsafe_op_in_unsafe_fn`,
RPIT capture, both temporary-scope changes, `static_mut_refs`; `unsafe
extern`, unsafe attributes and `gen` via the 1.82 and 1.85 posts. The `!`
fallback, `Box<[T]>`, prelude and resolver entries: EDG sub-pages not opened
(unverified detail). Migrate with `cargo fix --edition`, then review its `match`
rewrites from `if_let_rescope`: they keep the 2021 drop order.

## 6. Concurrency model

- `Send`: ownership may move to another thread. `Sync`: `&T` may be shared
  (`T: Sync` iff `&T: Send`). Both are auto traits derived from the fields;
  raw pointers, `Rc`, `Cell`, `RefCell` opt out, and `MutexGuard` is not
  `Send` — NOM Send and Sync, BOOK 16.4.
- A data race (concurrent access, one a write, one unsynchronised) is UB and
  safe Rust prevents it through ownership plus `Send`/`Sync`. Race
  conditions and deadlocks are safe and still possible; combined with
  `unsafe` (check-then-use on an atomic index) they can break memory
  safety — NOM Data Races, STD `sync::atomic`.
- `unsafe impl Send`/`Sync` is a promise other safe code relies on; review it
  as `unsafe` (4.3) — NOM Send and Sync.
- Atomics follow the C++20 model without consume; `Relaxed` for independent
  counters, `Release`/`Acquire` to publish, a `Mutex` for multi-variable
  invariants; widths vary by target (`cfg(target_has_atomic)`) — STD
  `sync::atomic`.
- Choose: message passing (channel or an owning task) first; `Mutex` for an
  invariant; atomics for one word; `thread::scope` to borrow locals across
  threads — ER item 17, TOK Shared state, STD `thread::scope`.
- Async: tasks are multiplexed on worker threads and move between them at
  `.await`, so a spawned future must be `Send + 'static` and must not hold a
  non-`Send` guard across `.await`. A std mutex is the default in async code
  for short critical sections; `tokio::sync::Mutex` only when held across
  `.await` — TOK `spawn`, `sync::Mutex`.
- Blocking calls and long computation without `.await` stall the worker and
  every task on it: async API, `spawn_blocking` (bounded, not cancellable
  once started), a dedicated thread, or rayon — TOK `spawn_blocking`.
- `join!` is concurrency on one task, not parallelism; `spawn` gives
  parallelism — TOK `join!`.
- Correctness vs speed: a wrong result, UB, or a hang is 4.4; only slower is
  4.5.

## 7. Linter mapping

**Compiling is execution.** `cargo check`, `clippy`, `build`, `test` and
`bench` compile and run `build.rs` (CARGO build scripts) and run procedural
macros inside the compiler with its file and I/O access (REF procedural
macros). Never run them on a diff under review unless the run is opted in
(`JIG_REVIEW_EXEC=1`); read the project's CI output instead and pass it to
the review, and name the command for a human otherwise. Never report "no
issues" from a tool that did not run. Without opt-in, run only tools that
read files: `cargo fmt --check` (parses source without building; carried
over from the former agent, not re-verified), `cargo audit` (reads `Cargo.lock`, AUDIT),
`cargo deny check` (DENY; whether it never builds was not confirmed from
its docs: unverified). Do not restate what a tool that ran already reported.

When clippy runs (CI or opt-in), the default set is `correctness` (deny),
`suspicious`, `style`, `complexity`, `perf` (warn). `pedantic` is allow and
noisy; never enable `restriction` or `nursery` wholesale — pick lints (CLG).
Project choices live in `[lints.clippy]` / `[lints.rust]` (CARGO).

| Item | Caught by |
|---|---|
| rs-unwrap-prod | `clippy::unwrap_used`, `expect_used`, `indexing_slicing` (restriction, opt-in) |
| rs-panic-macro | `clippy::todo`, `unimplemented`, `panic` (restriction) |
| rs-must-use-dropped | rustc `unused_must_use` (warn); `clippy::let_underscore_future` (suspicious), `let_underscore_must_use` (restriction) |
| rs-let-underscore-guard | rustc `let_underscore_lock` (deny) |
| rs-wildcard-enum | `clippy::wildcard_enum_match_arm` (restriction), `match_wildcard_for_single_variants` (pedantic) |
| rs-temp-scope | rustc `if_let_rescope`, `tail_expr_drop_order` (allow; in `rust-2024-compatibility`) |
| rs-clone-for-borrowck | `clippy::redundant_clone` (nursery, opt-in) |
| rs-borrow-params | `clippy::ptr_arg` (style), `needless_pass_by_value` (pedantic) |
| rs-lifetimes | `clippy::needless_lifetimes` (complexity), rustc `mismatched_lifetime_syntaxes` (warn) |
| rs-err-type | `clippy::result_unit_err` (style) |
| rs-err-source | `clippy::map_err_ignore` (restriction) |
| rs-err-doc | `clippy::missing_errors_doc`, `missing_panics_doc` (pedantic) |
| rs-unsafe-safety-comment | `clippy::undocumented_unsafe_blocks` (restriction) |
| rs-unsafe-fn-doc | `clippy::missing_safety_doc` (style) |
| rs-unsafe-op-in-fn | rustc `unsafe_op_in_unsafe_fn` (warn in 2024, allow before) |
| rs-unsafe-scope | `clippy::multiple_unsafe_ops_per_block` (restriction); rustc `unsafe_code` (allow) to forbid it crate-wide |
| rs-ub-list | `clippy::mut_from_ref`, `uninit_vec`, `not_unsafe_ptr_arg_deref` (correctness); rustc `invalid_reference_casting`, `mutable_transmutes`, `deref_nullptr` (deny), `invalid_value`, `dangling_pointers_from_temporaries`, `dangling_pointers_from_locals` (warn); Miri at test time |
| rs-static-mut | rustc `static_mut_refs` (warn; deny in 2024) |
| rs-unsafe-send-sync | `clippy::non_send_fields_in_send_ty` (nursery) |
| rs-guard-across-await | `clippy::await_holding_lock`, `await_holding_refcell_ref` (suspicious) |
| rs-relock | `clippy::if_let_mutex` (correctness) |
| rs-async-trait-send | rustc `async_fn_in_trait` (warn); `clippy::future_not_send` (nursery) |
| rs-arc-non-send | `clippy::arc_with_non_send_sync` (suspicious), `rc_mutex` (restriction) |
| rs-needless-collect | `clippy::needless_collect` (nursery) |
| rs-to-owned | `clippy::unnecessary_to_owned`, `iter_overeager_cloned` (perf) |
| rs-alloc-in-loop | `clippy::format_push_string` (pedantic) |
| rs-large-variant | `clippy::large_enum_variant`, `result_large_err` (perf) |
| rs-box-collection | `clippy::box_collection`, `redundant_allocation` (perf), `vec_box` (complexity) |
| rs-mutex-counter | `clippy::mutex_atomic`, `mutex_integer` (restriction) |
| rs-lock-scope | `clippy::significant_drop_tightening` (nursery) |
| rs-index-loop | `clippy::needless_range_loop` (style), `manual_memcpy` (perf) |
| rs-from-not-into, rs-ctor, rs-conv-names, rs-question-mark | `clippy::from_over_into`, `new_without_default`, `wrong_self_convention`, `question_mark` (style) |
| rs-mut-key | `clippy::mutable_key_type` (suspicious) |
| rs-allow-reason | `clippy::allow_attributes_without_reason` (restriction); rustc `unfulfilled_lint_expectations` for `#[expect]` |
| rs-pub-docs, rs-visibility | rustc `missing_docs`, `unreachable_pub` (allow, opt-in) |
| rs-test-result-assert | `clippy::assertions_on_result_states` (restriction) |
| dead code, unused items | rustc `dead_code`, `unused_variables` (warn) |
| formatting | `cargo fmt --check` |
| vulnerable, yanked, unmaintained, banned or badly licensed dependencies | `cargo audit` (AUDIT), `cargo deny check` (DENY) |
| edition migration | `cargo fix --edition` (review its output) |

No linter decides: whether a clone or allocation is on a hot path, whether
`unsafe` is sound, whether a `SAFETY` argument is true, lock order across
functions, whether a trait should be `dyn` or generic, the error-type design,
whether a channel's producer is bounded, or whether a version or edition gate
applies. Those are the review's work.
