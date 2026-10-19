# C++ review standard

The one C++ standard for both the model writing C++ and `code-reviewer`
reviewing a C++ diff. It lists what to check and where the rule comes from;
detail and code live in the skills it links: `cpp-coding-standards` (Core
Guidelines walkthrough with examples, house naming and formatting) and
`cpp-testing` (GoogleTest, CTest, coverage, sanitizer builds).

Before applying any rule, read the language floor (`CMAKE_CXX_STANDARD`,
`-std=`, `cxx_std_NN` in `target_compile_features`), the compilers and
standard libraries the CI matrix builds with (GCC/libstdc++, Clang/libc++,
MSVC STL), the flags of the shipping build (`-O`, `-DNDEBUG`, LTO, hardening
macros, any sanitizer left on) and whether the project builds with
exceptions (`-fno-exceptions`). A rule gated on a version does not apply
below it, and a library feature counts only when every standard library in
the matrix ships it (CR-CS).

Sources are cited by the short name in the first column of section 1. Core
Guidelines rules are cited by id (`CG R.11`); the anchor is the rule's
lowercase name in the guideline source.

## 1. Sources

| Short | Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|---|
| CG | C++ Core Guidelines (Stroustrup, Sutter, eds.) | https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines (source: https://github.com/isocpp/CppCoreGuidelines) | Rule ids P, I, F, C, R, ES, E, Con, T, CP, SL, SF, NL, Per; Enforcement notes; lifetime profile | Document dated 2026-06-14; last commit 2026-08-06; self-described "release 0.8", living document | Standard C++ Foundation licence (document calls it MIT-style; LICENSE grants personal or internal business use) |
| CR | cppreference.com language and library pages: multi-threaded executions and data races, `memory_order`, undefined behaviour, object lifetime, default initialization (indeterminate and erroneous values), copy elision, range-for, `reinterpret_cast`, `strcpy`, `basic_string_view`, `span`, `vector` (iterator invalidation), `vector::reserve`, `vector<bool>`, `shared_ptr`, `make_shared`, `function`, `move_only_function`, `map::find`, `flat_map`, `condition_variable`, `jthread`, `hardware_destructive_interference_size`, cv-qualifiers | https://en.cppreference.com/w/cpp/ + page path (for example `.../language/multithread.html`, `.../atomic/memory_order.html`) | Language rules, UB catalogue, memory model, library contracts | Fetched 2026-10-19 | CC BY-SA 3.0 and GFDL (not shown on the fetched pages; unverified) |
| CR-CS | cppreference compiler support (C++17, 20, 23, 26) and the C++26 overview | https://en.cppreference.com/w/cpp/compiler_support/17.html (and `20`, `23`, `26`), https://en.cppreference.com/w/cpp/26.html | Which GCC, Clang, MSVC, Apple Clang release implements each feature | Fetched 2026-10-19 | As CR |
| ISO | isocpp.org Current Status | https://isocpp.org/std/status | Standardization state | Page says "C++26 work in progress"; ISO publication of C++26 unverified | Standard C++ Foundation, all rights reserved (linked, not copied) |
| GSG | Google C++ Style Guide | https://google.github.io/styleguide/cppguide.html | Include what you use, forward declarations, static storage duration, implicit conversions, ownership, integer types, exceptions, naming | Last commit 2024-04-08; targets C++20; a company guide, follow the project where it differs | CC BY 3.0 |
| ASAN / UBSAN / TSAN / MSAN | Clang sanitizer docs | https://clang.llvm.org/docs/AddressSanitizer.html, https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html, https://clang.llvm.org/docs/ThreadSanitizer.html, https://clang.llvm.org/docs/MemorySanitizer.html | What each detects, overhead, check groups | Clang docs, fetched 2026-10-19 | LLVM project (Apache-2.0 WITH LLVM-exception; not stated on the pages, unverified) |
| TSA | Clang Thread Safety Analysis | https://clang.llvm.org/docs/ThreadSafetyAnalysis.html | `-Wthread-safety`, `GUARDED_BY` | Fetched 2026-10-19 | As ASAN |
| HARD | libc++ Hardening Modes | https://libcxx.llvm.org/Hardening.html | `_LIBCPP_HARDENING_MODE` none/fast/extensive/debug, assertion semantics, C++26 hardening wording | Fetched 2026-10-19 | As ASAN |
| GLIBCXX | libstdc++ Macros | https://gcc.gnu.org/onlinedocs/libstdc++/manual/using_macros.html | `_GLIBCXX_ASSERTIONS`, `_GLIBCXX_DEBUG` | Fetched 2026-10-19 | GFDL 1.3 |
| GCCW | GCC Warning Options; C++ Dialect Options; Developer Options | https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html, https://gcc.gnu.org/onlinedocs/gcc/C_002b_002b-Dialect-Options.html, https://gcc.gnu.org/onlinedocs/gcc/Developer-Options.html | Warning names (`-Wdangling-reference`, `-Wuse-after-free`, `-Wpessimizing-move`, `-Winterference-size`), `-fopt-info` | GCC online docs, fetched 2026-10-19 | GFDL 1.3 |
| GCCA | GCC Static Analyzer Options | https://gcc.gnu.org/onlinedocs/gcc/Static-Analyzer-Options.html | `-fanalyzer` | The page states the analyzer "is only suitable for use on C code in this release" | GFDL 1.3 |
| OSSF | OpenSSF Compiler Options Hardening Guide for C and C++ | https://best.openssf.org/Compiler-Hardening-Guides/Compiler-Options-Hardening-Guide-for-C-and-C++.html | Recommended warning and hardening flags, brown-field adoption | 2026-08-20 | CC BY 4.0 |
| TIDY | clang-tidy check list | https://clang.llvm.org/extra/clang-tidy/checks/list.html | Check names (`bugprone-`, `cppcoreguidelines-`, `performance-`, `modernize-`, `concurrency-`, `misc-`) | Docs for in-progress LLVM 24; a check may be newer than the installed clang-tidy | As ASAN |
| CPPCHECK | Cppcheck | https://cppcheck.sourceforge.io/ | UB-focused static analysis, low false-positive goal | 2.22 | GPL-3.0 |
| BENCH | google/benchmark user guide | https://github.com/google/benchmark/blob/main/docs/user_guide.md | `DoNotOptimize`, `ClobberMemory`, repetitions | main branch, fetched 2026-10-19 | Apache-2.0 |
| GTEST | GoogleTest primer and advanced guide | https://google.github.io/googletest/primer.html, https://google.github.io/googletest/advanced.html | `ASSERT_*` vs `EXPECT_*`, death tests | main branch, fetched 2026-10-19 | BSD-3-Clause |
| CWE770 | CWE-770 Allocation of Resources Without Limits or Throttling | https://cwe.mitre.org/data/definitions/770.html | Unbounded containers, caches, threads | CWE 4.20 | MITRE CWE terms of use |

Not opened in this run and therefore not cited: the ISO standard text and
working draft (eel.is), Abseil Tips of the Week, include-what-you-use docs,
the Clang diagnostics reference, MSVC `/analyze` and `/W4` docs, the SEI
CERT C++ standard, Valgrind and perf manuals. Treat any claim resting on
them as unverified.

## 2. Mindset

- Every resource has one owner object whose destructor releases it (RAII);
  raw pointers and references never own (CG R.1, R.3, R.4, I.11).
- Prefer values and scoped objects; heap-allocate only when lifetime or size
  demands it (CG R.5, C.10, F.20).
- Rule of Zero first; define or delete all five special members only when a
  class manages a resource directly (CG C.20, C.21).
- Undefined behaviour is not "works on my machine": the compiler may assume
  it never happens, so a data race, signed overflow, out-of-bounds access or
  dangling dereference invalidates the whole program (CR undefined
  behaviour).
- Make the type system carry the contract: `const` by default, strong types,
  checks at compile time before run time (CG P.4, P.5, Con.1).
- Abstractions should cost nothing you did not ask for, and performance
  claims need a measurement (CG Per.6, Per.7).
- Formatting is clang-format's job; it is not review.

## 3. Habits carried from other languages

| Habit | Do instead | Source |
|---|---|---|
| C-style `malloc`/`free`, manual `new`/`delete` pairs | Containers, `std::make_unique`, `std::make_shared` | CG R.10, R.11, R.23 |
| `new` for every object (Java, C#) | Automatic storage or a member; heap only when needed | CG R.5 |
| `shared_ptr` everywhere as a GC substitute | `unique_ptr` unless ownership is genuinely shared; break cycles with `weak_ptr` | CG R.21, R.24, GSG "Ownership and Smart Pointers" |
| C strings and `strcpy`/`sprintf` buffers | `std::string` owns, `std::string_view` observes | CG SL.str.1, SL.str.2, CR `strcpy` |
| Pointer plus length parameters (C) | `std::span` (C++20) or a container reference | CG R.14, I.13, F.24 |
| `#define` constants and function macros (C) | `constexpr`, `enum class`, inline functions | CG ES.31, Enum.1, Enum.3 |
| C casts and `memcpy` type punning | Named casts; `std::bit_cast` (C++20) | CG ES.48, ES.49, C.183, CR `reinterpret_cast` |
| `volatile` as a thread-visibility flag (Java) | `std::atomic` or a mutex | CG CP.8, CR `memory_order` (volatile and threads) |
| Error codes in `errno`-style globals (C) | Exceptions, or `std::expected` (C++23) where the project bans exceptions | CG E.28, E.2 |
| `unsigned` to mean "never negative" | Signed arithmetic; unsigned for bit patterns | CG ES.102, ES.106, GSG "Integer Types" |
| Every class polymorphic with getters/setters (Java) | `struct` for independent data, `class` with an invariant | CG C.2 (in `cpp-coding-standards`), C.120 |
| `catch (...)` in every function | Catch where you can handle; let others propagate | CG E.17, E.18 |

## 4. Review items

Format: `id` — trigger visible in a diff — what to check — why — source.
One-line items are general knowledge; detail appears only where judgment or
a threshold is involved. A finding names the concrete failure scenario;
"might be unsafe" is not a finding.

### 4.1 Memory safety and lifetimes

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cpp-naked-new | `new`/`delete` outside a resource-handle class | `make_unique`/`make_shared` or a container | Leak on any early exit or throw | CG R.11, ES.60, C.149, TIDY cppcoreguidelines-owning-memory |
| cpp-malloc | `malloc`/`calloc`/`free` in C++ code | Containers or smart pointers | No constructors, no RAII | CG R.10, TIDY cppcoreguidelines-no-malloc |
| cpp-raw-owner | `T*` returned or stored that the receiver must delete | `unique_ptr<T>` | Raw pointers are non-owning | CG I.11, R.3, F.26 |
| cpp-alloc-expr | Two `new` in one expression, `f(shared_ptr<A>(new A), g())` | One allocation per statement, use `make_*` | Leak if the other subexpression throws | CG R.12, R.13 |
| cpp-delete-array | `new[]` freed with `delete`, or the reverse | Matching form, better a `vector` | UB | CG ES.61 |
| cpp-dangling-return | Function returns a pointer, reference or view to a local or a by-value parameter | Return by value | Dangles at return; C++26 makes binding a returned reference to a temporary ill-formed (GCC 14, Clang 19) | CG F.43, CR-CS 26 (P2748), GCCW `-Wdangling-reference` |
| cpp-view-lifetime | `string_view`/`span` member, return value or local initialized from a temporary `std::string`/container, or kept beyond the owner | Name the owner and why it outlives the view, or store an owning type | Caller-owned lifetime; temporary dies at end of full expression | CR `basic_string_view` ("programmer's responsibility"), CG SL.str.2, TIDY bugprone-dangling-handle |
| cpp-iter-invalidation | `push_back`/`insert`/`erase`/`resize` while holding an iterator, pointer or reference into the same `vector`/`string`; erasing inside a range-for | Re-acquire after modification; erase-remove or the returned iterator | Invalidation rules per container | CR `vector` "Iterator invalidation", CG ES.65 (Enforcement) |
| cpp-range-for-temp | `for (auto& x : make().member())` or a chain through a temporary while the floor is below C++23 | Bind the temporary to a named variable first | Only the outermost temporary is extended before C++23 (P2718: GCC 15, Clang 19) | CR range-for "Temporary range initializer", CR-CS 23 |
| cpp-lambda-ref-capture | `[&]` or `&local` capture in a lambda stored, returned, queued or passed to another thread | Capture by value, or prove the scope outlives the call | Dangling captures | CG F.52, F.53, CP.31 |
| cpp-this-capture | `[=]` in a member function | Explicit `[this]` or `[*this]` | `[=]` captures `this`, not members by value | CG F.54 |
| cpp-coroutine-ref | Coroutine taking reference parameters, or a capturing lambda that is a coroutine | Pass by value | Parameters and captures dangle after the first suspension | CG CP.51, CP.53, TIDY cppcoreguidelines-avoid-reference-coroutine-parameters, -avoid-capturing-lambda-coroutines |
| cpp-use-after-move | Moved-from object read before reassignment | Reassign or stop using it | Only valid-but-unspecified state is promised | CG C.64, ES.56, TIDY bugprone-use-after-move |
| cpp-smart-get | Pointer from `.get()` or `*sp` passed down while the callee can reset the original `shared_ptr` | Pin a local copy first | Object destroyed under the callee | CG R.37 |
| cpp-null | Pointer dereferenced where null is possible; parameter that must not be null typed `T*` | `T&`, `gsl::not_null`, or a check at the boundary | Null dereference is UB | CG I.12, F.23, ES.65 |
| cpp-bounds | `operator[]`, pointer arithmetic or C arrays indexed by data-derived values | Range-for, algorithms, `span`, `at()` on untrusted indices; enable library hardening (4.2) | Out-of-bounds access is UB | CG SL.con.3, ES.55, R.14, TIDY cppcoreguidelines-pro-bounds-pointer-arithmetic |
| cpp-c-string | `strcpy`, `strcat`, `sprintf`, `gets`, fixed `char[]` buffers | `std::string`, `std::format` (C++20) | UB when the destination is too small | CR `strcpy`, CG SL.str.1, TIDY bugprone-unsafe-functions |
| cpp-slice | Derived object passed or copied by value as its base | Pass by reference; suppress public copy on polymorphic bases | Sliced state | CG ES.63, C.67, C.145, TIDY cppcoreguidelines-slicing |
| cpp-array-base-ptr | `Derived[]` assigned to `Base*` | `span<Derived>` or a container | Pointer arithmetic uses the wrong size | CG C.152 |
| cpp-memset-nontrivial | `memset`/`memcpy` on a type with constructors or virtuals | Constructors and assignment | Breaks invariants and vptrs | CG C.90, SL.con.4, TIDY bugprone-undefined-memory-manipulation |
| cpp-rule-of-five | Class declares a destructor, copy or move operation but not the rest | Rule of Zero, or all five | Implicit copies double-free the resource | CG C.20, C.21, TIDY cppcoreguidelines-special-member-functions |
| cpp-virtual-dtor | Base with virtual functions and a public non-virtual destructor | Public virtual or protected non-virtual | Deleting through the base is UB | CG C.35, C.127, TIDY cppcoreguidelines-virtual-class-destructor, GCCW `-Wnon-virtual-dtor` |
| cpp-self-assign | Hand-written copy or move assignment | Safe for `x = x` (copy-and-swap or check) | Frees its own data | CG C.62, C.65, TIDY bugprone-unhandled-self-assignment |
| cpp-static-init | Namespace-scope object with a non-trivial constructor or destructor | `constexpr`/`constinit`, or a function-local static | Initialization order across translation units and destruction-order bugs | GSG "Static and Global Variables", CG I.2 |

### 4.2 Undefined behaviour

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cpp-uninit | Local or member declared without an initializer; constructor that leaves members unset | Initialize at declaration; default member initializers | Reading an indeterminate value is UB; C++26 turns it into erroneous behaviour (GCC 16), still a bug | CG ES.20, C.41, C.48, CR default initialization, CR-CS 26 (P2795), TIDY cppcoreguidelines-init-variables, -pro-type-member-init |
| cpp-signed-overflow | Arithmetic on sizes, counters or untrusted input in `int`; `a * b` widened after the multiply | Check before the operation, wider type, or saturation arithmetic (C++26) | Signed overflow is UB; unsigned wraps silently | CG ES.103, ES.104, CR undefined behaviour "Signed overflow", TIDY bugprone-implicit-widening-of-multiplication-result |
| cpp-signed-unsigned | Signed/unsigned comparison or arithmetic; `for (int i; i < v.size();)` | `std::ssize`, `std::cmp_less` (C++20), consistent types | Negative values become huge | CG ES.100, ES.106, TIDY modernize-use-integer-sign-comparison, GCCW `-Wsign-conversion` |
| cpp-narrowing | Implicit `double`→`int`, `int64_t`→`int32_t`, `size_t`→`int` | `{}` init, `gsl::narrow`, or an explicit checked cast | Silent truncation | CG ES.46, ES.23, TIDY bugprone-narrowing-conversions, GCCW `-Wconversion` |
| cpp-div-zero-shift | Division or modulo by a data-derived divisor; shift by a data-derived count | Validate the operand | UB | CG ES.105, UBSAN |
| cpp-eval-order | Same variable modified twice in one expression; arguments depending on each other's side effects | Split statements | Unspecified or undefined order | CG ES.43, ES.44 |
| cpp-type-pun | `reinterpret_cast` between unrelated object types, union punning | `std::bit_cast` (C++20) or `memcpy` into a trivially copyable type | Strict-aliasing violation is UB | CR `reinterpret_cast` "Type aliasing", CG C.183, TIDY cppcoreguidelines-pro-type-reinterpret-cast |
| cpp-const-cast | `const_cast` used to write | Remove; fix the API | Writing a const object is UB | CG ES.50, TIDY cppcoreguidelines-pro-type-const-cast |
| cpp-c-cast | `(T)x` or `T(x)` on non-arithmetic types | `static_cast` and friends | Silently becomes `reinterpret_cast` or `const_cast` | CG ES.48, ES.49, TIDY cppcoreguidelines-pro-type-cstyle-cast, GCCW `-Wold-style-cast` |
| cpp-virtual-in-ctor | Virtual call in a constructor or destructor | Non-virtual helper or factory | Calls the base version; pure virtual is UB | CG C.82 |
| cpp-varargs | `va_arg`, `printf` family with a non-literal format | Variadic templates, `std::format`/`std::print` | Type mismatches are UB; user-controlled formats are an exploit sink | CG F.55, OSSF `-Wformat=2 -Werror=format-security`, TIDY cppcoreguidelines-pro-type-vararg |
| cpp-lib-hardening | New or changed build config with no standard library hardening | libc++ `_LIBCPP_HARDENING_MODE_FAST` (production) or libstdc++ `-D_GLIBCXX_ASSERTIONS` | Turns many library-precondition UB cases (bounds, empty `optional`) into traps; libstdc++ assertions are off by default when optimizing | HARD, GLIBCXX, OSSF |

### 4.3 Error handling

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cpp-throw-type | `throw` of `int`, `const char*`, `std::string` | Purpose-designed type derived from `std::exception` | Callers cannot catch by meaning | CG E.14 |
| cpp-catch-value | `catch (std::exception e)` | Catch by `const&` | Slicing | CG E.15, TIDY misc-throw-by-value-catch-by-reference, GCCW `-Wcatch-value` |
| cpp-catch-order | Base-class `catch` before a derived one | Most derived first | Derived handler unreachable | CG E.31 |
| cpp-swallow | `catch (...) {}` or log-and-continue where the caller needs the failure | Handle, rethrow, or comment why ignoring is right | Lost failure | CG E.17, E.18 |
| cpp-dtor-throw | Destructor, `swap`, deallocation or move that can throw | `noexcept` and no throw | Throwing during unwinding calls `std::terminate` | CG E.16, C.36, C.37, C.85, TIDY bugprone-exception-escape |
| cpp-move-noexcept | Move constructor or move assignment not `noexcept` | Add `noexcept` | `vector` falls back to copying on reallocation | CG C.66, TIDY performance-noexcept-move-constructor |
| cpp-noexcept-lie | `noexcept` on a function that can throw | Remove it or make it non-throwing | Throw becomes `std::terminate` | CG F.6, E.12, CR `noexcept` specifier |
| cpp-cleanup | Manual cleanup on each return path | RAII handle, or `gsl::finally` when none exists | Missed path leaks | CG E.6, E.19 |
| cpp-error-strategy | Mixed error styles in one module (exceptions, codes, `errno`, `optional`) | One strategy per boundary; `std::expected` (C++23) or a result type where exceptions are banned; check the project's `-fno-exceptions` | Callers miss failures | CG E.1, E.28, GSG "Exceptions" (Google bans them; follow the project) |
| cpp-nodiscard | Function returning an error code, status or resource that callers must use | `[[nodiscard]]` (C++17) | Ignored errors compile silently | CR-CS 17 |
| cpp-optional-access | `*opt`/`opt.value()` or `*expected` without a check on a path that can be empty | Check, `value_or`, or monadic operations (C++23) | UB on `*` of an empty object | TIDY bugprone-unchecked-optional-access |

### 4.4 Concurrency

Section 6 has the model. These are the diff-level triggers.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cpp-data-race | Non-atomic variable written by one thread and read or written by another without a happens-before edge | Mutex, atomic, or confine to one thread | A data race is UB | CR multi-threaded executions and data races, CG CP.2, CP.3 |
| cpp-volatile-sync | `volatile` flag or counter shared between threads | `std::atomic` | `volatile` gives no inter-thread ordering (MSVC's default is non-standard) | CG CP.8, CP.200, CR `memory_order` |
| cpp-manual-lock | `m.lock()`/`m.unlock()` | `std::lock_guard`/`std::scoped_lock`/`std::unique_lock` | Unlock skipped on throw or early return | CG CP.20, TIDY modernize-use-scoped-lock |
| cpp-unnamed-guard | `std::lock_guard<std::mutex>(m);` or `std::unique_lock(m);` as a statement | Name the guard | The temporary unlocks immediately | CG CP.44, ES.84, TIDY bugprone-unused-raii |
| cpp-lock-order | Two mutexes taken in separate statements | `std::scoped_lock(a, b)` | Deadlock from inconsistent order | CG CP.21 |
| cpp-lock-callback | Callback, virtual call or user code invoked under a lock; I/O under a lock | Copy what is needed, unlock, then call | Deadlock and contention | CG CP.22, CP.43 |
| cpp-cv-wait | `cv.wait(lock)` with no predicate | `wait(lock, pred)` | Spurious wakeups and lost notifications | CG CP.42, CR `condition_variable`, TIDY bugprone-spuriously-wake-up-functions |
| cpp-detach | `std::thread::detach()`; `std::thread` member with no join on every path | `std::jthread` (C++20) or join in a scope | Detached threads outlive the data they touch; a joinable `std::thread` destructor calls `terminate` | CG CP.23, CP.24, CP.26, CR `jthread` |
| cpp-mutex-with-data | Mutex declared away from the data it protects; no annotation | Keep them together; Clang `GUARDED_BY` with `-Wthread-safety` where the project uses it | Unprotected accesses go unnoticed | CG CP.50, TSA |
| cpp-dcl | Hand-written double-checked locking | Function-local static or `std::call_once` | Easy to get wrong without the right orderings | CG CP.110, CP.111 |
| cpp-lock-free | New lock-free structure or relaxed/acquire/release orderings | Justify with a measurement and a proof sketch per ordering; default `seq_cst` otherwise | Wrong ordering is UB or a silent bug | CG CP.100, CP.101, CR `memory_order` |
| cpp-mt-unsafe | `strtok`, `localtime`, `rand`, `getenv`-style non-reentrant calls in threaded code | Reentrant or C++ alternatives | Shared internal state | TIDY concurrency-mt-unsafe |
| cpp-thread-churn | `std::thread` created per request or item | A pool or task system with a bound | Creation cost and unbounded threads | CG CP.4, CP.41, CWE770 |

### 4.5 Performance

Report a cost only with the hot-path argument (which loop or call path, and
what bounds n) and the concrete cost (an allocation per iteration, an
n-byte copy per call, an indirect call per element, a cache line written by
two threads). Cost in startup, configuration parsing, CLI handling, error
paths or test fixtures is not a finding (CG Per.1, Per.3). Without
measurement, label the finding "needs measurement" and name the command
that would confirm it (a google-benchmark run with `--benchmark_repetitions`
and `benchmark::DoNotOptimize` on results, BENCH; `-fopt-info` for
vectorization, GCCW); never claim the compiler did or did not elide,
inline or vectorize something without disassembly or `-fopt-info` output
(CG Per.6). Do not configure or build a diff to measure without explicit
opt-in: CMake, Meson and Bazel run code the diff controls. A view-based fix
is valid only with the lifetime argument from cpp-view-lifetime.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cpp-perf-param | Large owning type (`std::string`, `vector`, a big struct) taken by value and only read; small trivially copyable type taken by `const&` | `const T&`, `string_view`, `span<const T>`; by value for cheap types. Enforcement thresholds: warn by value above `4 * sizeof(void*)`, by `const&` at or below `2 * sizeof(void*)` | Copy per call | CG F.16 (Enforcement), TIDY performance-unnecessary-value-param |
| cpp-perf-sink | Parameter that is stored, taken by `const&` then copied | By value and `std::move` into place, or `&&` overload | Avoids a second copy | CG F.18, TIDY modernize-pass-by-value |
| cpp-perf-cstr-ref | `const std::string&` parameter called with literals or `string_view` on a hot path | `std::string_view` | A temporary `std::string` (possibly an allocation) per call | CG SL.str.2 |
| cpp-perf-range-copy | `for (auto x : container)` over non-trivial elements | `const auto&` (or `auto&&` in generic code) | Copies every element | TIDY performance-for-range-copy, GCCW `-Wrange-loop-construct` |
| cpp-perf-last-use | Named local copied into a container or sink at its last use | `std::move` | Needless copy | CG ES.56, TIDY performance-unnecessary-copy-initialization |
| cpp-perf-pessimizing-move | `return std::move(local);`, `std::move` on a `const` object or a prvalue | Remove it | Blocks copy elision or silently copies | CG F.48, ES.56 (Enforcement), TIDY performance-move-const-arg, GCCW `-Wpessimizing-move`, `-Wredundant-move` |
| cpp-perf-return-const | Function returns `const T` | Return `T` | Inhibits moves | CG F.49 |
| cpp-perf-reserve | `push_back`/`emplace_back` loop whose count is known or estimable | `reserve(n)` first; name where n comes from | Repeated reallocation and element moves | CR `vector::reserve`, CG Per.14, TIDY performance-inefficient-vector-operation |
| cpp-perf-loop-alloc | Container or `std::string` constructed inside a hot loop body; `+` concatenation in a loop | Hoist and `clear()` (keeps capacity); `+=`/`append`, or `std::format_to` into one buffer | Allocation per iteration | CG Per.14, Per.15, TIDY performance-inefficient-string-concatenation |
| cpp-perf-node-container | `std::map`/`set`/`list` or `vector<unique_ptr<T>>` on a traversal hot path with small n | Sorted `vector` or `std::flat_map` (C++23); name the expected size | Node allocation and a pointer chase per element | CG SL.con.2, Per.16, Per.19, CR `flat_map` |
| cpp-perf-hetero-lookup | `std::string` key built per lookup in a loop | Transparent comparator (`std::less<>`) and `string_view` keys | Removes a temporary per lookup | CR `map::find` (overloads 3, 4) |
| cpp-perf-shared-ptr | `shared_ptr` passed by value where the callee does not share ownership; `shared_ptr<T>(new T)` | `T&`/`T*`, or `const shared_ptr&`; `make_shared` | Each copy is an atomic count update; `new` form is two allocations (`make_shared` keeps storage alive while any `weak_ptr` exists) | CG R.30, R.36, R.22, CR `shared_ptr`, CR `make_shared` |
| cpp-perf-std-function | `std::function` on a per-element path | Template parameter or a lambda passed directly; `std::move_only_function` (C++23) | Type erasure: indirect call, and targets beyond small-object storage may allocate | CR `function` constructor, CR `move_only_function` |
| cpp-perf-false-sharing | Two atomics or mutable members written by different threads in one struct; `vector<Counter>` indexed by thread id | Align or pad to `std::hardware_destructive_interference_size` (C++17; libc++ 19) and name the members | One cache line ping-pongs between cores | GCCW `-Winterference-size`, CR `hardware_destructive_interference_size`, CR-CS 17 |
| cpp-perf-seq-cst-counter | Statistic counter with default `seq_cst` on a hot path | `memory_order_relaxed` only when no other data is published through it | Relaxed needs atomicity only; misuse is a race | CR `memory_order` (relaxed: counters) |
| cpp-perf-virtual-hot | Virtual call per element in a tight loop over a closed set of types; `dynamic_cast` in a loop | `std::variant` + `std::visit`, a template, or type known up front (needs measurement) | Indirect call blocks inlining; `dynamic_cast` walks the hierarchy | CG Per.10, C.146, C.153 |
| cpp-perf-layout | Hot loop reads one field of an array of large structs; inner loop strides across rows; padding holes from mixed alignment | Structure of arrays, swap loop order, reorder members; give sizes before and after (needs measurement for SoA) | Cache lines carry unused bytes | CG Per.16, Per.17, Per.19 |
| cpp-perf-vector-bool | `std::vector<bool>` on a hot path or where `bool&`/`data()` is expected | `vector<char>`, `bitset`, or a bit container chosen on purpose | Proxy references; not a normal container | CR `vector<bool>` |
| cpp-perf-endl | `std::endl` in an output loop | `'\n'` | Flushes each line | CG SL.io.50, TIDY performance-avoid-endl |
| cpp-perf-unbounded | Container, cache, queue or thread set that grows with input with no bound or eviction | A bound with a stated size, eviction policy, or streaming | Memory or thread exhaustion | CWE770 |
| cpp-perf-compile-time | Table or value computed at startup from constants | `constexpr`/`consteval` | Moves work to compile time | CG Per.11, Con.5 |

Not findings: `return local;` and `auto x = f();` (guaranteed elision for
prvalues since C++17, CR copy elision; NRVO is permitted); copies outside a
hot path; inlining, vectorization or branch-prediction claims, `inline`,
`__restrict`, `[[likely]]` or manual unrolling without a measurement;
`++it` versus `it++`; `const` on by-value parameters; templating a body over
many types without a code-size number (CG Per.1, Per.6).

### 4.6 API design

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cpp-explicit-ctor | Single-argument constructor or conversion operator without `explicit` | `explicit` unless the conversion is intended | Silent conversions | CG C.46, GSG "Implicit Conversions", TIDY google-explicit-constructor |
| cpp-override | Overriding function without `override`, or with `virtual` and `override` together | Exactly one of `virtual`, `override`, `final` | Signature drift creates a new function | CG C.128, TIDY modernize-use-override, GCCW `-Woverloaded-virtual` |
| cpp-virtual-default-arg | Override with a different default argument | Same defaults, or none on virtuals | Default chosen by static type | CG C.140 |
| cpp-out-params | Output parameters for results | Return a value or a struct | Clearer, enables elision | CG F.20, F.21 |
| cpp-smart-param | `unique_ptr`/`shared_ptr` parameter where the function does not change ownership | `T&`/`T*` | Constrains callers needlessly | CG F.7, R.30, R.32–R.35 |
| cpp-forward-move | `std::move` on a forwarding reference, `std::forward` on an rvalue reference | Swap them | Moves from caller's lvalue | CG F.19, ES.56, TIDY bugprone-move-forwarding-reference, cppcoreguidelines-missing-std-forward |
| cpp-const-member | `const` or reference data member in a copyable or movable type | Non-const member with a const accessor | Disables assignment | CG C.12, TIDY cppcoreguidelines-avoid-const-or-ref-data-members |
| cpp-const-correct | Member function that does not modify state, not `const`; pointer or reference parameters not `const` when read only | Add `const` | Contract and overload resolution | CG Con.2, Con.3, TIDY misc-const-correctness |
| cpp-enum-class | Plain `enum` | `enum class` | Scoped names, no implicit int conversion | CG Enum.3 |
| cpp-global-mutable | Non-const namespace-scope or static variable | Pass state explicitly | Hidden coupling and races | CG I.2, R.6 |
| cpp-concepts | Unconstrained template with a common name in a visible namespace | Constrain with standard concepts (C++20) | Hijacks overload resolution; unreadable errors | CG T.10, T.11, T.47 |
| cpp-specialize-fn | Explicit specialization of a function template | Overload | Specializations do not take part in overloading | CG T.144 |
| cpp-adjacent-params | Adjacent parameters of the same type with different meanings (`f(int width, int height)`) | Strong types or a struct | Swapped arguments compile | CG I.4, I.24 |
| cpp-eq-symmetric | Member `operator==` with implicit conversions on one side only | Symmetric, `noexcept`; `= default` with `<=>` (C++20) | Asymmetric comparisons | CG C.86 |

### 4.7 Build and compile time

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cpp-iwyu | File uses a symbol from a header it does not include directly | Include what you use; no transitive reliance | Breaks when another header is cleaned up | GSG "Include What You Use", CG SF.10, TIDY misc-include-cleaner |
| cpp-header-self-contained | New header that compiles only after other includes | Self-contained header | Order-dependent builds | CG SF.11 |
| cpp-include-guard | Header without include guard or `#pragma once` | Add one | Redefinition errors | CG SF.8 |
| cpp-using-namespace-header | `using namespace` at namespace scope in a header | Qualify, or use inside functions | Pollutes every includer | CG SF.7, TIDY google-build-using-namespace |
| cpp-header-definitions | Non-inline function or object definitions in a header; unnamed namespace in a header | `inline`, or move to the `.cpp` | ODR violations and duplicate symbols | CG SF.2, SF.21, TIDY misc-definitions-in-headers |
| cpp-internal-linkage | File-local helpers with external linkage | Unnamed namespace | Symbol clashes, missed optimization | CG SF.22, TIDY misc-use-anonymous-namespace |
| cpp-include-cycle | Headers that include each other | Break the cycle | Fragile builds | CG SF.9, TIDY misc-header-include-cycle |
| cpp-forward-decl | New forward declarations of another library's types to save an include | Include the header; forward-declare only within your own module | Hides dependencies, blocks API evolution | GSG "Forward Declarations" |
| cpp-macro | Macros for constants, functions or code generation | `constexpr`, templates, inline functions; ALL_CAPS unique names if unavoidable | No scope, no types | CG ES.30, ES.31, ES.33, TIDY cppcoreguidelines-macro-usage |
| cpp-heavy-template-header | Large template or metaprogram added to a widely included header | `constexpr` functions; explicit instantiation in one `.cpp`; Pimpl for stable ABI | Compile time across every includer | CG T.120, I.27 |

### 4.8 Naming and readability

Follow the project's naming convention first (`cpp-coding-standards` lists
the house variants); the rules below hold whatever the convention.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cpp-all-caps | ALL_CAPS on non-macros | Reserve ALL_CAPS for macros | Collides with macros | CG NL.9, ES.9, Enum.5 |
| cpp-hungarian | Type encoded in names (`strName`, `pData`) | Plain names | Lies after refactors | CG NL.5 |
| cpp-magic | Unnamed literals with domain meaning | Named `constexpr` | Intent | CG ES.45 |
| cpp-nullptr | `0` or `NULL` as a pointer | `nullptr` | Overload ambiguity | CG ES.47, TIDY modernize-use-nullptr |
| cpp-typedef | `typedef` | `using` | Readable, works with templates | CG T.43, TIDY modernize-use-using |
| cpp-shadow | Name reused in a nested scope | Rename | Wrong variable used | CG ES.12, GCCW `-Wshadow` |
| cpp-fallthrough | `switch` case falls through without `[[fallthrough]]` | Mark or `break` | Accidental fallthrough | CG ES.78, OSSF `-Wimplicit-fallthrough` |
| cpp-auto | Long iterator or repeated type spelled out, or `auto` hiding a type the reader needs (proxy, narrowing) | `auto` to avoid repetition, explicit type where it matters | Readability and correctness | CG ES.11 |
| cpp-scope | Variable declared far before use or reused for two purposes | Declare at first use with its value | Smaller scope | CG ES.5, ES.21, ES.22, ES.26 |
| cpp-goto | `goto` outside breaking nested loops | Structured control flow | Readability | CG ES.76, TIDY cppcoreguidelines-avoid-goto |

### 4.9 Testing

Patterns live in `cpp-testing`; whether tests protect behaviour at all is
`test-reviewer`'s question.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cpp-test-assert-expect | `EXPECT_*` on a precondition later dereferenced (`EXPECT_TRUE(p); p->x`) | `ASSERT_*` for preconditions | `EXPECT_*` continues after failure into a crash | GTEST primer (fatal vs non-fatal) |
| cpp-test-sanitizers | New concurrency or memory-sensitive code with no ASan/UBSan/TSan CI job | Add the sanitizer build (`cpp-testing`) | Races and UB are invisible in normal runs; TSan reports are effectively always real races | CG CP.9, ASAN, UBSAN, TSAN |
| cpp-test-sleep | `sleep` used to order threads in a test | Latches, condition variables, bounded waits | Flaky | `cpp-testing` |
| cpp-test-death | Death test in a binary that has started threads | `threadsafe` death test style | `fork` with threads is unsafe | GTEST advanced (death tests and threads) |
| cpp-bench-dce | Benchmark whose result is unused | `benchmark::DoNotOptimize` / `ClobberMemory` | Optimizer deletes the measured work | BENCH |

## 5. Version-gated modern features

Gate on the language floor and on every compiler and standard library in
the CI matrix (CR-CS). Google's guide targets C++20 and forbids C++23
features in its own code (GSG); follow the project's floor.

| Version | Suggest | Old form still right when | Source |
|---|---|---|---|
| C++17 | Guaranteed copy elision for prvalues; `[[nodiscard]]`; `if constexpr`; structured bindings; `std::string_view`, `std::optional`, `std::variant`; `std::scoped_lock`; `std::pmr` (libstdc++ 9.1, libc++ 16); `hardware_destructive_interference_size` (libstdc++ 12.1, libc++ 19) | `const std::string&` when the callee passes the text on to an API that takes a `std::string`; libc++ below 19 for interference size: use a literal 64 with a comment | CR-CS 17, CR `basic_string_view` |
| C++20 | Concepts; `std::span`; ranges; `std::format` (GCC 13, libc++ 17); `std::jthread` and `stop_token` (libc++ complete in 20); `<=>`; `consteval`/`constinit`; `std::bit_cast`; `std::source_location`; `std::cmp_*`, `std::ssize`; modules (partial in all three compilers) | `std::format` below GCC 13 (use `{fmt}`); modules while toolchain support is partial | CR-CS 20 |
| C++23 | `std::expected` and monadic operations; `std::print` (GCC 14, libc++ 18); `std::flat_map`/`flat_set` (GCC 15, libc++ 20); deducing `this`; `std::move_only_function` (no libc++ entry); `std::mdspan`; `std::unreachable`; `std::to_underlying`; range-for temporary lifetime extension (GCC 15, Clang 19); `import std` (partial); `std::start_lifetime_as` (GCC 16) | Exceptions where the project uses them (`expected` is not a blanket replacement); `std::map` when iterator stability or large n with frequent inserts matters | CR-CS 23 |
| C++26 (ISO publication unverified) | Erroneous behaviour for uninitialized reads and `[[indeterminate]]` (GCC 16); contracts (GCC 16); reflection (GCC 16); standard library hardening (libstdc++ 15 partial, MSVC partial); `std::inplace_vector` (GCC 16); saturation arithmetic; `= delete("reason")`; binding a returned reference to a temporary is ill-formed (GCC 14, Clang 19); `std::execution`; hazard pointers and RCU; `std::optional<T&>` | Everything here until every compiler in the matrix ships it; erroneous behaviour does not make reading an uninitialized value correct; use library-vendor hardening (`_LIBCPP_HARDENING_MODE`, `_GLIBCXX_ASSERTIONS`) today | CR-CS 26, CR C++26, HARD, ISO |

## 6. Concurrency model

- Two conflicting evaluations (at least one writes the same memory location)
  form a data race unless both are atomic, they run on the same thread, or
  one happens-before the other. A data race is undefined behaviour — CR
  multi-threaded executions. There is no "benign" race in standard C++.
- `std::atomic` operations default to `memory_order_seq_cst`. `relaxed`
  gives atomicity only, typical for counters (the `shared_ptr` increment
  uses it, the decrement needs acquire-release); `release` on a store paired
  with `acquire` on the load that reads it publishes everything written
  before the store — CR `memory_order`. Weaker orderings need a stated
  reason per operation (CG CP.100–CP.102).
- `volatile` is for memory outside the C++ program (devices); it gives no
  inter-thread ordering — CG CP.8, CP.200, CR `memory_order`.
- Different `shared_ptr` objects sharing ownership may be used from several
  threads; the same `shared_ptr` object, and the pointee, still need
  synchronization (`std::atomic<std::shared_ptr>` in C++20) — CR
  `shared_ptr`.
- Locks: RAII guards only, `scoped_lock` for several mutexes, no unknown
  code under a lock, short critical sections, the mutex beside the data —
  CG CP.20–CP.22, CP.43, CP.50.
- Threads: think in tasks, not threads; join every thread in a scope
  (`std::jthread`), never `detach`; pass small data by value — CG CP.4,
  CP.23–CP.26, CP.31.
- Waiting: always with a predicate; spurious wakeups happen — CG CP.42, CR
  `condition_variable`.
- Initialization: function-local statics are initialized thread-safely
  since C++11; prefer them or `std::call_once` over hand-written
  double-checked locking — CG CP.110.
- Tools: Clang Thread Safety Analysis checks lock annotations statically;
  ThreadSanitizer finds races at run time on the paths executed (5x–15x
  slowdown, 5x–10x memory) — CG CP.9, TSA, TSAN.
- Coroutines: parameters by value and no capturing coroutine lambdas;
  both dangle after the first suspension — CG CP.51, CP.53.
- Correctness versus speed: a race, deadlock or detached thread is 4.4;
  contention, false sharing and needless `seq_cst` are 4.5.

## 7. Linter and tool mapping

Run the project's own checks first (`.clang-tidy`, `CMakePresets.json`
warning flags, `lefthook.yml`, `.pre-commit-config.yaml`, CI results via
`gh pr checks`) and pass their output to the review; never report "no
issues" from a tool that did not run, and do not restate what a tool that
ran already reported. clang-tidy and include-cleaner need a compilation
database, which comes from configuring the project; configuring and
building execute CMake, Meson or Bazel code the diff controls, so without
explicit opt-in read CI's output instead. `cppcheck` can analyse sources
without a build. Avoid `--checks='*'`: it enables modules with conflicting
house styles (for example `fuchsia-`, `llvmlibc-`); use the project's
`.clang-tidy`, or `bugprone-*,cppcoreguidelines-*,performance-*,modernize-*,concurrency-*,misc-*`
as a starting set.

Compiler warnings to expect in a C++ project (OSSF, GCCW): `-Wall -Wextra
-Wconversion -Wsign-conversion -Wformat=2 -Werror=format-security
-Wimplicit-fallthrough -Wshadow -Wnon-virtual-dtor -Wold-style-cast
-Woverloaded-virtual`; GCC adds `-Wdangling-reference`, `-Wuse-after-free`,
`-Wdangling-pointer`, `-Wpessimizing-move`, `-Wredundant-move`,
`-Winterference-size`; Clang adds `-Wthread-safety` with annotations (TSA).
OSSF also recommends `-D_FORTIFY_SOURCE=3`, `-D_GLIBCXX_ASSERTIONS`,
`-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_FAST` and
`-fstack-protector-strong`, enabled gradually on existing projects. GCC's
`-fanalyzer` is documented as suitable only for C code (GCCA); do not rely
on it for C++.

Sanitizers (ASAN, UBSAN, TSAN, MSAN): ASan finds heap, stack and global
out-of-bounds, use-after-free, use-after-return, use-after-scope, double
free and leaks (about 2x slowdown); `-fsanitize=undefined` excludes
`unsigned-integer-overflow`, `implicit-conversion`, `float-divide-by-zero`,
`local-bounds`, `vptr` and `nullability-*`, and the unsigned and
implicit-conversion checks report defined behaviour; TSan finds data races;
MSan finds uninitialized reads (about 3x slowdown).

| Item | Tool rule |
|---|---|
| cpp-naked-new, cpp-raw-owner, cpp-malloc | cppcoreguidelines-owning-memory, cppcoreguidelines-no-malloc, modernize-make-unique, modernize-make-shared; ASan |
| cpp-dangling-return, cpp-view-lifetime | bugprone-dangling-handle, bugprone-return-const-ref-from-parameter; GCC `-Wdangling-reference`, `-Wdangling-pointer`; ASan use-after-scope/return |
| cpp-iter-invalidation, cpp-bounds | cppcoreguidelines-pro-bounds-pointer-arithmetic, -pro-bounds-constant-array-index, modernize-avoid-c-arrays; ASan; library hardening |
| cpp-use-after-move | bugprone-use-after-move |
| cpp-c-string, cpp-varargs | bugprone-unsafe-functions, bugprone-not-null-terminated-result, cppcoreguidelines-pro-type-vararg, modernize-use-std-print, modernize-use-std-format; `-Wformat=2` |
| cpp-rule-of-five, cpp-virtual-dtor, cpp-self-assign, cpp-slice | cppcoreguidelines-special-member-functions, -virtual-class-destructor, bugprone-unhandled-self-assignment, cppcoreguidelines-slicing; `-Wnon-virtual-dtor` |
| cpp-memset-nontrivial | bugprone-undefined-memory-manipulation |
| cpp-uninit | cppcoreguidelines-init-variables, -pro-type-member-init; `-Wuninitialized`, `-Wmaybe-uninitialized`; MSan |
| cpp-signed-overflow, cpp-signed-unsigned, cpp-narrowing | bugprone-implicit-widening-of-multiplication-result, bugprone-narrowing-conversions, modernize-use-integer-sign-comparison; `-Wconversion`, `-Wsign-conversion`; UBSan `signed-integer-overflow` |
| cpp-type-pun, cpp-const-cast, cpp-c-cast | cppcoreguidelines-pro-type-reinterpret-cast, -pro-type-const-cast, -pro-type-cstyle-cast, bugprone-bitwise-pointer-cast, bugprone-casting-through-void; `-Wold-style-cast`; UBSan |
| cpp-catch-value, cpp-dtor-throw, cpp-move-noexcept | misc-throw-by-value-catch-by-reference, bugprone-exception-escape, performance-noexcept-move-constructor, cppcoreguidelines-noexcept-move-operations; `-Wcatch-value` |
| cpp-optional-access | bugprone-unchecked-optional-access |
| cpp-data-race, cpp-mutex-with-data | TSan; Clang `-Wthread-safety` |
| cpp-manual-lock, cpp-unnamed-guard, cpp-cv-wait, cpp-mt-unsafe | modernize-use-scoped-lock, bugprone-unused-raii, bugprone-spuriously-wake-up-functions, concurrency-mt-unsafe |
| cpp-coroutine-ref, cpp-lambda-ref-capture | cppcoreguidelines-avoid-reference-coroutine-parameters, -avoid-capturing-lambda-coroutines |
| cpp-perf-param, cpp-perf-sink | performance-unnecessary-value-param, modernize-pass-by-value |
| cpp-perf-range-copy, cpp-perf-last-use | performance-for-range-copy, performance-unnecessary-copy-initialization; `-Wrange-loop-construct` |
| cpp-perf-pessimizing-move | performance-move-const-arg, performance-no-automatic-move; `-Wpessimizing-move`, `-Wredundant-move` |
| cpp-perf-reserve, cpp-perf-loop-alloc, cpp-perf-endl | performance-inefficient-vector-operation, performance-inefficient-string-concatenation, performance-avoid-endl |
| cpp-perf-false-sharing | `-Winterference-size` (questionable uses only) |
| cpp-explicit-ctor, cpp-override, cpp-forward-move, cpp-const-member, cpp-const-correct | google-explicit-constructor, modernize-use-override, bugprone-move-forwarding-reference, cppcoreguidelines-missing-std-forward, cppcoreguidelines-avoid-const-or-ref-data-members, misc-const-correctness; `-Woverloaded-virtual` |
| cpp-iwyu, cpp-include-cycle, cpp-header-definitions, cpp-internal-linkage, cpp-using-namespace-header | misc-include-cleaner, misc-header-include-cycle, misc-definitions-in-headers, misc-use-anonymous-namespace, google-build-using-namespace, google-global-names-in-headers |
| cpp-macro, cpp-nullptr, cpp-typedef, cpp-goto, cpp-shadow | cppcoreguidelines-macro-usage, modernize-use-nullptr, modernize-use-using, cppcoreguidelines-avoid-goto; `-Wshadow` |
| Undefined behaviour broadly | cppcheck (UB focus, few false positives) |

No tool decides: who owns a pointer and whether a view outlives its owner
across functions, whether a path is hot, whether an ordering weaker than
`seq_cst` is justified, whether a lock is held across user code in another
file, whether the error strategy fits the module, or whether a version gate
holds for every toolchain in the matrix. Those are the review's work.
