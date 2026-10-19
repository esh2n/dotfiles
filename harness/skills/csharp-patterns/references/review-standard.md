# C# review standard

The one C# standard for both the model writing C# and `code-reviewer`
reviewing a C# diff. It lists what to check and where the rule comes from;
house style and code live in the skills it links: `csharp-patterns` (records,
immutability, options pattern, DI lifetimes, the API envelope, secrets),
`csharp-testing` (xUnit, mocking, Testcontainers, `WebApplicationFactory`).

Before applying any rule, read `<TargetFramework(s)>`, `<LangVersion>`,
`<Nullable>`, `<AnalysisLevel>`/`<AnalysisMode>` in the `.csproj` and any
`Directory.Build.props`, plus `global.json` (the SDK). The target framework
sets the default language version (.NET 8 is C# 12, .NET 9 is C# 13, .NET 10
is C# 14); a rule gated on a version does not apply below it (LV, WN). On
2026-10-19, .NET 10 is the active LTS (to 2028-11-14); .NET 8 (LTS) and .NET
9 (STS) both reach end of support on 2026-11-10; .NET 11 is at RC2
("go-live") and C# 15 is preview (POL).

Sources are cited by the short name in the first column of section 1; a
`#fragment` or page name after it narrows the reference. Rule pages are
`https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/<id>`.

## 1. Sources

| Short | Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|---|
| FDG | .NET Framework Design Guidelines: pages `exception-throwing`, `using-standard-exception-types`, `exceptions-and-performance`, `property`, `field`, `guidelines-for-collections`, `choosing-between-class-and-struct`, `capitalization-conventions` | https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/ + page name | Do/Avoid rules for public API, exceptions, properties, collections, struct choice | Updated 2023-10-03 (collections 2021-09-15); excerpted from the 2008 2nd edition, the page itself warns some guidance may be out of date | Portions © Microsoft and Pearson, reprinted by permission; cite only, never copy |
| CONV | C# coding conventions; Identifier naming rules | https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions, https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/identifier-names | `var`, keyword types, catching, `using`, raw strings, `_camelCase` fields, `I` prefix, PascalCase constants | 2025-01-18; 2026-07-14 | CC BY 4.0 (dotnet/docs) |
| PROPS | Properties (programming guide) | https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/properties | Accessors, `field` keyword, accessor accessibility | 2025-11-19 | CC BY 4.0 |
| NRT / NRTA / NRTW | Nullable reference types; Nullable static analysis attributes; Nullable warnings | https://learn.microsoft.com/en-us/dotnet/csharp/nullable-references, https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/attributes/nullable-analysis, https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/nullable-warnings | `<Nullable>enable</Nullable>`, `!`, `[NotNullWhen]`, default-struct and array pitfalls, CS86xx | 2026-05-26; 2026-01-14; 2026-07-20 | CC BY 4.0 |
| REC | Records | https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record | Value equality, mutability, EF Core needs reference equality | Current, fetched 2026-10-19 | CC BY 4.0 |
| TAP / TAPI | Task-based Asynchronous Pattern; Implementing the TAP | https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/task-based-asynchronous-pattern-tap, https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/implementing-the-task-based-asynchronous-pattern | `Async` suffix, `ValueTask` only when measured, cancellation overloads, usage exceptions thrown synchronously, compiler state machine | 2026-04-30; 2026-08-06 | CC BY 4.0 |
| ABP | Stephen Cleary, "Async/Await - Best Practices in Asynchronous Programming", MSDN Magazine | https://learn.microsoft.com/en-us/archive/msdn-magazine/2013/march/async-await-best-practices-in-asynchronous-programming | Avoid `async void`, async all the way, context-capture deadlock | March 2013 (archive); the deadlock model still holds for UI and classic ASP.NET contexts | Microsoft terms of use |
| CAFAQ | Stephen Toub, "ConfigureAwait FAQ", .NET Blog | https://devblogs.microsoft.com/dotnet/configureawait-faq/ | When to use `ConfigureAwait(false)`: library vs app code; ASP.NET Core has no `SynchronizationContext` | 2019-12-11; still the reference answer | Microsoft terms of use |
| AG | David Fowler, AspNetCoreDiagnosticScenarios `AsyncGuidance.md` | https://github.com/davidfowl/AspNetCoreDiagnosticScenarios/blob/master/AsyncGuidance.md | `async void`, sync over async, `Task.Run`, CTS disposal, TCS options, `ContinueWith`, `GetOrAdd` with async, constructors | Last commit 2024-03-20; its ConfigureAwait section is "TBD" (use CAFAQ) | No licence declared in the repository; cite only |
| CANCEL | Task cancellation | https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/task-cancellation | `ThrowIfCancellationRequested`, `OperationCanceledException` | 2025-10-20 | CC BY 4.0 |
| TPS | Debug ThreadPool starvation | https://learn.microsoft.com/en-us/dotnet/core/diagnostics/debug-threadpool-starvation | Starvation symptoms, `dotnet-counters`, .NET 6 heuristics, .NET 9 `WaitHandleWait` event | 2025-05-30 | CC BY 4.0 |
| EXBP | Best practices for exceptions | https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions | `throw;` vs `throw ex;`, `ExceptionDispatchInfo`, catch `OperationCanceledException`, synchronous argument validation | 2025-10-22 | CC BY 4.0 |
| DISP / DISPA | Implement a Dispose method; Implement a DisposeAsync method | https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-dispose, https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-disposeasync | Idempotent `Dispose`, `Dispose(bool)`, `IAsyncDisposable` alongside `IDisposable` | 2025-10-22; 2025-10-20 | CC BY 4.0 |
| THR / LOCK | Managed threading best practices; `lock` statement | https://learn.microsoft.com/en-us/dotnet/standard/threading/managed-threading-best-practices, https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/lock | Lock targets, `Interlocked`, no `await` inside `lock`, `System.Threading.Lock` | Current, fetched 2026-10-19 | CC BY 4.0 |
| CA | Code quality rules (one page per rule) and code analysis overview | https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/, https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/overview | CAxxxx rules, "Enabled by default in .NET 10" per rule, `AnalysisMode` levels | Rule pages fetched 2026-10-19; overview 2025-11-11 | CC BY 4.0 |
| MSB | MSBuild properties for .NET SDK projects | https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props | `AnalysisLevel`, `AnalysisMode`, `EnforceCodeStyleInBuild`, `CodeAnalysisTreatWarningsAsErrors` | 2026-09-21 | CC BY 4.0 |
| IDE | Code-style rules | https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/style-rules/ | IDExxxx rules | 2026-07-09 | CC BY 4.0 |
| FMT | `dotnet format` | https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-format | Subcommands, `--verify-no-changes`, `--folder`, "only invoke against trusted code" | 2026-09-18 | CC BY 4.0 |
| ASPP | ASP.NET Core best practices (performance) | https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices | Blocking calls, `Task.Run`, LOH (85,000 bytes), `HttpContext` rules, background work, pagination, exceptions | 2025-12-31 | CC BY 4.0 (dotnet/AspNetCore.Docs) |
| ASPS | ASP.NET Core security pages: overview, `anti-request-forgery`, `preventing-open-redirects`, `cors`, `authorization/secure-data`; `fundamentals/error-handling`; `data/ef-rp/crud` (overposting); `fundamentals/host/hosted-services` | https://learn.microsoft.com/en-us/aspnet/core/security/ + page name | Secrets, CSRF, open redirect, CORS credentials, fallback policy, developer exception page, overposting, scoped services in hosted services | Overview 2026-07-22; others fetched 2026-10-19 | CC BY 4.0 |
| HTTPC | HttpClient guidelines | https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient-guidelines | Socket exhaustion, DNS, `PooledConnectionLifetime`, `IHttpClientFactory` | 2026-08-06 | CC BY 4.0 |
| DI | Dependency injection guidelines | https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection-guidelines | Thread-safe singletons, scope validation, service locator, `BuildServiceProvider` | 2026-03-11 | CC BY 4.0 |
| LOG | High-performance logging | https://learn.microsoft.com/en-us/dotnet/core/extensions/logging/high-performance-logging | `[LoggerMessage]` source generation, boxing | 2026-02-04 | CC BY 4.0 |
| MEM | `Memory<T>` and `Span<T>` usage guidelines; `ArrayPool<T>`; `ValueTask<TResult>` API | https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/memory-t-usage-guidelines, https://learn.microsoft.com/en-us/dotnet/api/system.buffers.arraypool-1, https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.valuetask-1 | Span vs Memory ownership rules, rent/return, await-once rule | 2025-04-11; API pages current | CC BY 4.0 |
| STR / TIME | Best practices for comparing strings; Choosing between DateTime types; TimeProvider overview | https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-strings, https://learn.microsoft.com/en-us/dotnet/standard/datetime/choosing-between-datetime, https://learn.microsoft.com/en-us/dotnet/standard/datetime/timeprovider-overview | Ordinal defaults, `DateTimeOffset`, `TimeProvider`/`FakeTimeProvider` | Current, fetched 2026-10-19 | CC BY 4.0 |
| EF | EF Core: efficient querying; advanced performance topics; tracking; single vs split queries; efficient updating; client evaluation; SQL queries; DbContext lifetime | https://learn.microsoft.com/en-us/ef/core/performance/efficient-querying (and `performance/advanced-performance-topics`, `querying/tracking`, `querying/single-split-queries`, `performance/efficient-updating`, `querying/client-eval`, `querying/sql-queries`, `dbcontext-configuration/`) | N+1, lazy loading, projection, pagination, no-tracking, cartesian explosion, `ExecuteUpdate`, compiled queries, pooling, raw SQL injection, thread safety | 2023-01-12 to 2026-09-03 per page | CC BY 4.0 (dotnet/EntityFramework.Docs) |
| WN | What's new in C# 12, 13, 14, 15; C# version history (10, 11) | https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14 (and `csharp-12`, `csharp-13`, `csharp-15`, `csharp-version-history`) | Version-gated features | C# 14 page 2026-09-03; C# 15 page 2026-09-14 (preview) | CC BY 4.0 |
| BRK14 | C# compiler breaking changes in .NET 10 | https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/breaking-changes/compiler%20breaking%20changes%20-%20dotnet%2010 | First-class span overload changes, `Enumerable.Reverse`, C# 14 below net10.0 unsupported | Fetched 2026-10-19 | CC BY 4.0 |
| LV | C# language versioning | https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/configure-language-version | Default version follows the target framework; never `latest` | 2026-01-20 | CC BY 4.0 |
| POL | .NET support policy; releases index | https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core, https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/releases-index.json | LTS three years, STS two years, end-of-support dates | Fetched 2026-10-19 | Microsoft terms of use; index MIT (dotnet/core) |
| UT / XU3 | Unit testing best practices; xUnit v3 what's new | https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-best-practices, https://xunit.net/docs/getting-started/v3/whats-new | Naming, no logic in tests, one Act, infrastructure dependencies; `TestContext.Current.CancellationToken` | 2025-03-22; current | CC BY 4.0; xunit.net licence not declared |
| BINF | BinaryFormatter security guide | https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-security-guide | The in-box implementation throws from .NET 9 | Fetched 2026-10-19 | CC BY 4.0 |
| HJ | Anders Hejlsberg, "The Trouble with Checked Exceptions" (Artima interview) | https://www.artima.com/articles/the-trouble-with-checked-exceptions | Why C# has no checked exceptions; try/finally far outnumbers try/catch | 2003-08-18 | Artima copyright; cite only |

Not opened in this run and therefore not cited: Microsoft.VisualStudio.Threading
analyzers (VSTHRD), StyleCop, Roslynator, SonarAnalyzer, Meziantou.Analyzer,
BenchmarkDotNet docs, OWASP .NET cheat sheet, the FDG third edition. Treat any
claim resting on them as unverified.

## 2. Mindset

- Nullable reference types are on; a warning means a real null path, and `!`
  is a claim the reviewer must be able to check (NRT).
- Exceptions report failures; they are not control flow. Catch only what the
  code can handle; most cleanup is `using`/`finally`, not `catch` (FDG, HJ).
- Async all the way: no blocking on tasks, no `async void`, the caller's
  `CancellationToken` flows to every call that takes one (ABP, AG).
- Library code and app code differ: `ConfigureAwait(false)` belongs in
  app-model-agnostic libraries, not in ASP.NET Core app code (CAFAQ).
- Prefer immutable value models (`record`, `init`, `with`) per the house
  rule in `csharp-patterns`; records give value equality, classes identity
  (REC).
- A performance finding needs n, frequency and context; `Span<T>`, pooling,
  compiled queries and `ValueTask` only where a measurement shows the cost
  (TAP, MEM, EF).
- Formatting and naming style are `.editorconfig` plus `dotnet format`;
  they are not review comments (FMT).

## 3. Habits carried from other languages

| Habit | Do instead | Source |
|---|---|---|
| `getName()`/`setName()` methods around a private field (Java beans) | A property; a method only for costly work or side effects; no public fields | FDG `property`, `field`; PROPS |
| Declaring and wrapping exceptions at every layer as with checked exceptions (Java) | Let exceptions propagate to a handler that can act; `try/finally` or `using` for cleanup | HJ, FDG `using-standard-exception-types`, CONV |
| `catch (Exception e)` everywhere "to be safe" | Catch specific types; general catch only at a top-level boundary | FDG `using-standard-exception-types`, CA1031 |
| Returning error codes or `null` to signal failure (C, Go) | Throw; offer a `TryX(out T)` pair for common expected failures | FDG `exception-throwing`, `exceptions-and-performance` |
| Blocking on futures (`future.get()`, Java) — `.Result`/`.Wait()` | `await`; make callers async (sync over async deadlocks or starves the pool) | ABP, AG, ASPP |
| `UPPER_SNAKE` constants (Java, C) | PascalCase constants | CONV identifier names |
| `String`/`Integer` wrapper types and `Int32` spelled out | Language keywords `string`, `int` | CONV |
| `synchronized(this)`-style locking on the instance or the class (Java) | A private lock object (`System.Threading.Lock` on .NET 9+) or `Interlocked`; never `lock(this)`/`lock(typeof(X))` | THR, LOCK |
| Fire-and-forget threads for background work (Node, Java executors) | A hosted service or queue with an owner; `async void` crashes the process on an unhandled exception | AG, ASPS hosted-services |

## 4. Review items

Format: `id` — trigger visible in a diff — what to check — why — source.
One-line items are general knowledge; detail appears only where judgment or
a threshold is involved. A finding names the concrete failure; "might be
unsafe" is not a finding.

### 4.1 Correctness and nullability

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cs-nullable-off | `<Nullable>` absent or `disable`, new `#nullable disable` | Enable for new code; a disable carries a reason | Null paths go unreported | NRT |
| cs-null-forgiving | New `!`, `null!`, `default!` | A null check, restructuring, or an annotation instead; a kept `!` has a visible invariant | Each `!` is a place the compiler no longer protects | NRT |
| cs-nullable-contract | `TryGet…`/`IsValid…` helper or guard method whose null-state the caller relies on | `[NotNullWhen]`, `[MaybeNullWhen]`, `[MemberNotNull]` on the signature | The analysis does not trace into method bodies | NRT, NRTA |
| cs-nullable-runtime | Public entry point taking a non-nullable reference from callers outside the nullable context (other assemblies, reflection, deserialization) | Runtime check (`ArgumentNullException.ThrowIfNull`) where the value crosses that boundary | `string` and `string?` are the same runtime type | NRT, CA1062, CA1510 |
| cs-default-struct | Struct with non-nullable reference fields created by `default`/`new()`; `new T[n]` of a non-nullable reference type | Required members, a constructor, or a collection expression | Fields and elements hold null with no warning | NRT "Known pitfalls" |
| cs-required | `= null!` or a suppressed CS8618 on a DTO property | `required` member (C# 11) or constructor parameter | Callers must set it; the suppression hides a missing value | NRT, NRTW |
| cs-record-equality | Record with array, `List<T>` or other mutable collection members compared or used as a key; record used as an EF Core entity | Custom equality or immutable collections; entities stay classes | Record equality compares members with their own equality (arrays by reference); EF Core needs reference equality | REC |
| cs-string-compare | `==`/`Equals`/`StartsWith`/`IndexOf`/`ToLower()` comparisons on identifiers, keys, headers, paths | `StringComparison.Ordinal`/`OrdinalIgnoreCase`; culture-aware only for text shown to users | Culture rules change results by machine locale | STR, CA1307, CA1309, CA1310, CA1862 |
| cs-format-culture | Number or date `ToString()`/`Parse`/interpolation producing machine-read output (JSON, CSV, keys, SQL) | `CultureInfo.InvariantCulture` | Decimal separators and formats vary by locale | CA1305 |
| cs-time | `DateTime.Now` stored, compared across machines, or used in logic under test | `DateTimeOffset`/UTC; inject `TimeProvider` | `DateTime` local values are ambiguous; `TimeProvider` makes time testable | TIME |
| cs-dispose | `IDisposable` created without `using`/`await using`; disposable field in a type that is not disposable | `using`; the owning type implements `IDisposable` (and `IAsyncDisposable` with `IDisposable`) | Leaked handles, connections, timers | CA2000, CA1001, CA2213, DISPA |
| cs-dispose-pattern | Unsealed type implementing `IDisposable` without `Dispose(bool)`; `Dispose` that throws on a second call | Standard pattern; idempotent `Dispose`; `GC.SuppressFinalize` correct | Subclasses and repeated calls break | DISP, CA1063, CA1816 |
| cs-ignored-result | `s.Trim();`, `date.AddDays(1);`, `items.Append(x);` (LINQ) as a statement | Assign the result | The API returns a new value; the call does nothing | CA1806 |
| cs-span-overload | C# 14 (net10.0) upgrade: arrays passed to overload sets taking both `IEnumerable<T>`/`T[]` and `Span<T>`/`ReadOnlySpan<T>`, covariant arrays | Confirm which overload binds now; `.AsEnumerable()`/`.AsSpan()` to pin it | First-class span conversions change overload resolution; covariant arrays can throw `ArrayTypeMismatchException` | BRK14 |
| cs-field-keyword | C# 14 upgrade in a type that has a member named `field` | `@field` or rename | `field` inside an accessor now means the backing field | WN C# 14 |

### 4.2 Exceptions

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cs-catch-general | `catch (Exception)`/`catch` without rethrow or filter below a top-level boundary | Catch the specific type; general catch only in top-level handlers (middleware, host loop, message pump) | Hides bugs and corrupt state | FDG `using-standard-exception-types`, CONV, CA1031 |
| cs-rethrow | `throw ex;` inside `catch` | `throw;`; `ExceptionDispatchInfo.Capture(ex).Throw()` when rethrowing outside the handler | Resets the stack trace | EXBP, CA2200 |
| cs-throw-type | `throw new Exception(…)`, `SystemException`, `ApplicationException`, or explicit `NullReferenceException`/`IndexOutOfRangeException` | `ArgumentException` family (with `ParamName`), `InvalidOperationException`, or a domain type | Callers cannot catch selectively; reserved types signal runtime bugs | FDG `using-standard-exception-types`, CA2201, CA2208 |
| cs-throw-helper | Hand-written `if (x is null) throw new ArgumentNullException(nameof(x))` | `ArgumentNullException.ThrowIfNull(x)` (and `ThrowIfNullOrEmpty` etc.); never on a nullable struct or a non-nullable value | Shorter; correct parameter name | CA1510, CA1871, CA2264 |
| cs-exception-flow | `try/catch` around parse, lookup or validation on a request or per-item path for outcomes that happen routinely | `TryParse`/`TryGetValue`/tester-doer; expected outcomes as return values | FDG notes throw rates above about 100 per second noticeably cost performance | FDG `exception-throwing`, `exceptions-and-performance`, ASPP |
| cs-cancel-catch | `catch (TaskCanceledException)`, or cancellation logged as an error or turned into a failure result | Catch `OperationCanceledException`; let it propagate or end quietly when the caller cancelled | Many APIs throw the base type; cancellation is not a fault | EXBP, CANCEL |
| cs-async-arg-check | Argument validation inside an `async` method body | Validate in a non-async wrapper, then call the async implementation | Usage errors should throw at the call, not when the task is awaited | TAP "Exceptions", EXBP |
| cs-finally-throw | `throw` inside `finally` or inside an exception filter | Move it out | Replaces the in-flight exception | FDG `exception-throwing` |
| cs-error-code | New public method returning an error code or an `Exception` object instead of throwing | Throw, or a `Try` pair. The house `ApiResponse<T>` envelope at the HTTP boundary is not this case | Error codes are ignored silently | FDG `exception-throwing`, `csharp-patterns` |

### 4.3 Async and concurrency

A finding needs a concrete interleaving, deadlock or starvation path, not
"might race".

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cs-sync-over-async | `.Result`, `.Wait()`, `.GetAwaiter().GetResult()`, `Task.Run(…).Result` on an incomplete task | `await` and make the caller async; `Main` and similar entry points are the only exception | Deadlocks under a single-threaded `SynchronizationContext` (UI, classic ASP.NET); starves the thread pool in ASP.NET Core | ABP, AG, ASPP, TPS |
| cs-sync-io-in-async | Synchronous I/O inside an `async` method: `File.ReadAllText`, `Thread.Sleep`, `Stream.Read`, EF `ToList()`/`SaveChanges()`, `StreamReader.EndOfStream` | The `…Async` counterpart (`Task.Delay`, `ReadAsync`, `ToListAsync`) | Blocks a pool thread for the duration | CA1849, CA2024, ASPP |
| cs-async-void | `async void` method other than a UI event handler; `async` lambda passed where an `Action` is expected (`List.ForEach`, `Timer` callback, `Parallel.ForEach`) | `async Task`; an API that takes `Func<Task>` | Exceptions cannot be caught and crash the process; the caller cannot await or test it | ABP, AG "Async void", "Implicit async void delegates" |
| cs-fire-forget | `_ = DoAsync();`, un-awaited task, or `Task.Run` started inside a request with no owner | Await it, or hand it to a hosted service/queue that owns its lifetime and errors; do not pass request-scoped disposables into it | Unobserved exceptions; scoped services disposed under it | AG, ASPP, CA2025 |
| cs-ct-flow | Method has a `CancellationToken` but a callee taking one gets none; new public async API without a token; token not the last parameter | Forward the token; add `CancellationToken cancellationToken = default` last | Cancellation stops at the first call that drops it | CA2016, CA1068, AG, TAP |
| cs-cts-dispose | `new CancellationTokenSource(timeout)` or `CancelAfter` without `using` | Dispose it | Timer stays queued until it fires | AG |
| cs-configureawait | `ConfigureAwait(false)` added to ASP.NET Core app code, or missing in a general-purpose library | Libraries that may run under any app model: use it. App code: omit it. CA2007 is for libraries | ASP.NET Core has no `SynchronizationContext`; libraries must not assume one | CAFAQ, CA2007 |
| cs-task-run | `await Task.Run(() => syncWork())` in ASP.NET Core; `Task.Run` returning a precomputed value; `Task.Run` around a loop that blocks for the app's lifetime | Call directly; `Task.FromResult`; a dedicated thread or `BackgroundService` | Extra pool scheduling; a pool thread lost for the app's lifetime | ASPP, AG |
| cs-valuetask | A `ValueTask` awaited twice, stored, read via `.Result` before completion; new `ValueTask` return types | Await once or `AsTask()`; introduce `ValueTask` only with measured allocation pressure | Undefined behaviour on reuse | MEM `ValueTask<TResult>`, TAP, CA2012 |
| cs-tcs | `new TaskCompletionSource<T>()` without `TaskCreationOptions.RunContinuationsAsynchronously` | Add it | Continuations run inline on the completing thread; deadlocks and stack dives | AG |
| cs-continuewith | `ContinueWith`, `Task.Factory.StartNew` without a scheduler | `await` | Scheduler and exception handling surprises | AG, CA2008 |
| cs-elide-async | Method returns a `Task` directly from inside `using` or `try` | `async`/`await` so the `using`/`try` covers the whole operation; eliding is fine for a one-line pass-through | Resource disposed before the task completes; exceptions surface in the wrong place | AG "Prefer async/await over directly returning Task" |
| cs-lock-async | Lock held across an `await` attempted through `Monitor` or a sync primitive | An async-compatible primitive (`SemaphoreSlim.WaitAsync` with `Release` in `finally`) | `await` is not allowed in a `lock` body; `Monitor` is thread-affine | LOCK |
| cs-lock-target | `lock(this)`, `lock(typeof(X))`, lock on a string or a public object | Private dedicated object; `System.Threading.Lock` on .NET 9+ | Outside code can take the same lock: deadlock | THR, LOCK, IDE0330 |
| cs-shared-state | Mutable field in a singleton or `static` written from requests (`Dictionary`, `List`, counters) | `ConcurrentDictionary`, `Interlocked`, or a lock; check-then-act under one lock | Singletons are shared by concurrent requests | DI, THR |
| cs-getoradd-async | `ConcurrentDictionary.GetOrAdd` factory calling `.Result` on an async operation | Cache `Task<T>`/`Lazy<Task<T>>` values | Blocks request threads; the factory can run more than once | AG "ConcurrentDictionary.GetOrAdd" |
| cs-dbcontext-parallel | One `DbContext` used by `Task.WhenAll`/parallel loops, or a second operation started before the first is awaited | One context per unit of work; `IDbContextFactory` per parallel branch | `DbContext` is not thread-safe; undetected concurrent use corrupts data | EF `dbcontext-configuration` |
| cs-unbounded-fanout | `Task.WhenAll(items.Select(…))` over a caller- or data-sized list | Bound it (`Parallel.ForEachAsync` with `ParallelOptions.MaxDegreeOfParallelism`, or a semaphore) and name the bound | Exhausts connection pools and remote limits | https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.parallel.foreachasync, `resilience-patterns` |

### 4.4 Performance

Report a cost only with n (what bounds the count or payload), the frequency
(per request, per item, per job) and the context. Startup, migrations,
tests and admin tools are not findings. Without a measurement, label the
finding "needs measurement" and name the tool (`dotnet-counters`,
`dotnet-trace`, a benchmark) instead of running it on the diff. LINQ in
ordinary code is the readable default (CONV); rewriting LINQ into loops,
adding `Span<T>`, `stackalloc`, pooling or `sealed` for speed is not a
finding without a profile of that path (ASPP "Understand hot code paths").

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cs-multi-enum | An `IEnumerable<T>` enumerated twice (`Count()` then `foreach`, `Any()` then `First()`) | Materialize once (`ToList`/`ToArray`) | Re-runs the query or generator | CA1851 |
| cs-count-any | `Count() > 0`, `Count()` on a collection, `Any()` on a type with `Count`/`Length` | `Any()` on sequences; the property on collections | Enumerates or allocates for nothing | CA1827, CA1829, CA1860 |
| cs-dict-lookup | `ContainsKey` then indexer or `Add` | `TryGetValue` / `TryAdd` | Two lookups | CA1854, CA1864 |
| cs-str-concat-loop | `+=` on a string inside a loop over unbounded input | `StringBuilder` | Quadratic copying | CONV |
| cs-json-options | `new JsonSerializerOptions(…)` per call | Cache one instance | Rebuilds metadata caches per call | CA1869 |
| cs-log-template | `logger.LogX($"…{x}")` or concatenated message; high-volume log calls | Message template with named placeholders; `[LoggerMessage]` source generator on hot paths | Interpolation runs even when the level is off and loses structured properties; extension methods box values | CA2254, CA1848, CA1873, LOG |
| cs-loh | Per-request arrays or strings of 85,000 bytes or more; whole request/response bodies read into memory | Stream, or pool buffers with `ArrayPool<T>` | Large-object-heap allocations are cleared and collected only with gen 2 | ASPP |
| cs-pool-misuse | `ArrayPool<T>.Rent` without `Return` in `finally`; buffer used after `Return`; code assuming `Rent(n)` returns exactly n | `try/finally`; slice to the requested length | `Rent` returns at least n; use after return corrupts another renter's data | MEM `ArrayPool<T>` |
| cs-span-memory | `Memory<T>` parameter on a synchronous API; `Memory<T>` used after the method (or its task) completes | `Span<T>`/`ReadOnlySpan<T>` for sync APIs; no use after return | Ownership rules 1, 3 and 4 | MEM |
| cs-stackalloc-loop | `stackalloc` inside a loop | Hoist it out of the loop | Stack overflow | CA2014 |
| cs-httpclient | `new HttpClient()` per call or inside `using` | Static/singleton client with `PooledConnectionLifetime`, or `IHttpClientFactory`; factory-created clients are short-lived, not held in singletons | Socket exhaustion; stale DNS | HTTPC, ASPP |
| cs-ef-lazy | `UseLazyLoadingProxies`, virtual navigations read in a loop | Eager loading (`Include`) or a projection; avoid lazy loading | N+1 queries | EF `efficient-querying` |
| cs-ef-projection | Whole entities loaded where a few columns are read | `Select` to the needed columns | Transfers and tracks unused data | EF `efficient-querying`, ASPP |
| cs-ef-unbounded | `ToListAsync()` over a table whose size the caller or data controls | `Take`/pagination | Memory and latency grow with the table | EF `efficient-querying`, ASPP |
| cs-ef-tracking | Read-only query without `AsNoTracking()` on a hot path | `AsNoTracking()`; `AsNoTrackingWithIdentityResolution()` when the same row repeats in the graph | Tracking snapshots cost time and memory | EF `efficient-querying`, `tracking`, ASPP |
| cs-ef-cartesian | Several collection `Include`s in one query | `AsSplitQuery()` (accepting no cross-query consistency) or a projection | Cartesian explosion | EF `single-split-queries` |
| cs-ef-client-eval | `ToList()`/`AsEnumerable()` before `Where`; untranslatable method in a filter; instance method captured in the top-level projection | Filter in the database; static helpers in projections | Loads whole tables; cached query plan can hold the instance (leak) | EF `client-eval`, ASPP |
| cs-ef-buffer | `ToList()` followed by more LINQ operators | `AsEnumerable()` or stream with `AsAsyncEnumerable()` | Buffers everything first | EF `efficient-querying` |
| cs-ef-bulk | Load, modify, `SaveChanges` loop for a set-based change | `ExecuteUpdateAsync`/`ExecuteDeleteAsync` (EF Core 7+); the change tracker is not updated | One round trip, no tracking | EF `efficient-updating` |
| cs-ef-dynamic-expr | Expression trees built with `Expression.Constant` for values that vary | Parameter expressions (a captured variable) | Each distinct constant compiles a new query and plan | EF `advanced-performance-topics` |
| cs-ef-compiled | `EF.CompileAsyncQuery`, `AddDbContextPool` added | Justified by a measured hot path; compiled queries need a single model | Complexity without measured gain | EF `advanced-performance-topics` |

Not findings: `Count()` on a code-bounded small list; LINQ in a controller
action that runs once per request over a handful of items; "make this a
`ValueTask`" without an allocation profile; `CA1822`/`CA1852` suggestions
reported as defects.

### 4.5 API design

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cs-public-field | Public or protected instance field | Property | Fields cannot change implementation later | FDG `field` |
| cs-property-shape | Set-only property, setter more visible than getter, getter that throws or does I/O | Get-only or `init`; method for costly work | Callers expect cheap, safe reads | FDG `property` |
| cs-collection-api | `List<T>`/`Dictionary<K,V>` in a public signature; settable collection property; `null` returned for "no items" | A read-only abstraction (`ReadOnlyCollection<T>`, or the project's `IReadOnlyList<T>` convention) and empty collections | Callers mutate internals; null checks everywhere | FDG `guidelines-for-collections` |
| cs-param-type | Public parameter typed `List<T>` but only enumerated | `IEnumerable<T>` (least specialized); for private/internal code CA1859 favours concrete types | Wider callers on public APIs; devirtualization internally | FDG `guidelines-for-collections`, CA1859 |
| cs-struct-choice | New `struct` that is mutable, larger than 16 bytes, or boxed often | Class, or `readonly record struct` when value-like and small | Copies and boxing cost; mutable copies surprise | FDG `choosing-between-class-and-struct` |
| cs-async-naming | Awaitable-returning method without `Async` suffix, or a sync method with it | Rename | Callers rely on the suffix | TAP |
| cs-try-pattern | New `TryX` method | Returns `bool` with an `out` result, plus a throwing `X` counterpart | Expected failures without exceptions | FDG `exceptions-and-performance` |
| cs-di-captive | Singleton depending on a scoped service (`DbContext`); `BuildServiceProvider()` during registration; `GetService` inside business code; `IServiceProvider` stored statically | Correct lifetimes with scope validation on; constructor injection | Captured scoped state outlives its scope; duplicate singletons | DI |
| cs-di-singleton-state | Singleton holding mutable state without synchronization | Make it thread-safe or change lifetime | Concurrent requests share it | DI |
| cs-config-strings | Raw `Configuration["…"]` reads spread through code | Options pattern (house rule) | Validation and typing in one place | `csharp-patterns` |
| cs-dynamic | `dynamic` in application code | Generics or explicit models (house rule) | No compile-time checking | `csharp-patterns` |
| cs-preview | `EnablePreviewFeatures`, `[RequiresPreviewFeatures]`, `<LangVersion>preview</LangVersion>` in production code | Remove; preview features may change or disappear | Not supported for production | CA2252, LV, WN C# 15 |

### 4.6 ASP.NET Core-specific

Language and framework sinks only. Authorization design, secrets handling and
supply chain belong to `security-reviewer`; hand those over.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cs-asp-sync-body | `Request.Form`, `StreamReader.ReadToEnd()` on the body, synchronous writes to the response | `ReadFormAsync`, `ReadToEndAsync`, async writes | Sync over async; thread-pool starvation | ASPP |
| cs-asp-ienumerable | Action returning an unmaterialized `IEnumerable<T>` from a query | Materialize asynchronously or return `IAsyncEnumerable<T>` | The serializer enumerates synchronously | ASPP |
| cs-asp-httpcontext | `IHttpContextAccessor.HttpContext` stored in a field; `HttpContext` read from parallel tasks, background work, or after the request ends | Copy the needed values first; read the accessor at use time | `HttpContext` is not thread-safe and is recycled after the request | ASPP |
| cs-asp-scoped-bg | `DbContext` or another scoped service captured by `Task.Run`/background work; scoped service injected into a hosted service constructor | `IServiceScopeFactory.CreateScope()` inside the work | Hosted services are singletons; the request scope is disposed | ASPP, ASPS hosted-services |
| cs-asp-headers | Headers or status set after the body may have started | `Response.HasStarted` check or `Response.OnStarting` | Throws or is ignored once the response started | ASPP |
| cs-asp-long-work | Long-running work awaited inside the request; custom middleware doing long tasks | Background service or queue; return early | Ties up requests and timeouts | ASPP |
| cs-asp-paging | Endpoint returning a whole collection whose size data controls | Page size and index | Memory, latency, LOH | ASPP |
| cs-asp-error-detail | Developer Exception Page outside Development; exception messages or stack traces in responses | `UseExceptionHandler`/ProblemDetails with safe text; detail in logs | Leaks internals | ASPS error-handling, `csharp-patterns` |
| cs-asp-cors | `AllowAnyOrigin` together with `AllowCredentials`; `AllowAnyOrigin` on an API that uses cookies; `UseCors` after `UseAuthorization` | Explicit origins; order `UseRouting`, `UseCors`, `UseAuthorization` | Cross-site requests with credentials | ASPS cors |
| cs-asp-csrf | Cookie-authenticated form or endpoint with `[IgnoreAntiforgeryToken]` or no antiforgery validation | Validate antiforgery tokens | Browsers attach cookies to cross-site requests | ASPS anti-request-forgery |
| cs-asp-open-redirect | `Redirect(returnUrl)` with a user-supplied URL | `LocalRedirect` or `Url.IsLocalUrl` check | Open redirect | ASPS preventing-open-redirects |
| cs-asp-authz | New endpoint with no `[Authorize]`/`RequireAuthorization` when no `FallbackPolicy` is set; new `[AllowAnonymous]` | Confirm the fallback policy and the intent | Endpoints are anonymous by default | ASPS secure-data |
| cs-asp-overposting | Entity type bound directly from the request body or form | Input DTO, or `TryUpdateModelAsync` with an explicit property list | Clients set fields they should not (roles, IDs) | ASPS ef-rp/crud |
| cs-asp-secret-config | Real secrets in `appsettings*.json` or code | Secret Manager in development, environment or a secret store in production | Committed credentials | ASPS overview, `csharp-patterns` |
| cs-sql-raw | `FromSqlRaw`/`ExecuteSqlRaw`/`SqlQueryRaw` or ADO.NET `CommandText` built with interpolation or concatenation of input | `FromSql`/`ExecuteSql` (interpolation becomes parameters) or explicit parameters; whitelist identifiers | SQL injection | EF `sql-queries`, CA2100, CA3001 |
| cs-deserialize | `BinaryFormatter`; Newtonsoft `TypeNameHandling` other than `None` on external input | `System.Text.Json` or typed contracts; `BinaryFormatter` throws from .NET 9 | Arbitrary type instantiation | CA2300, CA2326, BINF |
| cs-crypto | `System.Random` for tokens or keys; MD5/SHA1/DES; disabled certificate validation | `RandomNumberGenerator`; SHA-256+; default validation | Predictable or breakable secrets | CA5394, CA5350, CA5351, CA5359 |

### 4.7 Naming and readability

One line each; `.editorconfig` naming rules (IDE1006) and `dotnet format`
catch most when configured. Follow the project's `.editorconfig` where it
differs.

| id | Trigger | Check | Source |
|---|---|---|---|
| cs-casing | Types, members, constants not PascalCase; locals and parameters not camelCase; private fields not `_camelCase`; interfaces without `I` | Rename | CONV identifier names, FDG `capitalization-conventions`, IDE1006 |
| cs-underscores | Underscores in public identifiers | Remove | CA1707 |
| cs-keyword-types | `String`, `Int32`, `Boolean` in declarations | `string`, `int`, `bool` | CONV |
| cs-var | `var` where the type is not evident from the right-hand side | Explicit type, per the project's style rule | CONV |
| cs-unused | Unused `using`, parameter, or assignment | Remove | IDE0005, IDE0060, IDE0059 |
| cs-using-stmt | `try/finally` whose `finally` only calls `Dispose` | `using` statement or declaration | CONV |
| cs-raw-string | Escaped multi-line or quote-heavy literal | Raw string literal (C# 11) | CONV, WN version history |
| cs-modern-style | File-scoped namespace, primary constructor, collection expression available | Only when the project's `.editorconfig` asks (IDE0161, IDE0290, IDE0300); otherwise not a finding | IDE |
| cs-braces | Single-line `if`/`for` without braces | Per the project's IDE0011 setting | IDE |

### 4.8 Testing

Patterns live in `csharp-testing`; whether tests protect behaviour at all is
`test-reviewer`'s question.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| cs-test-async-void | `async void` test method | `async Task` | Runner cannot observe completion or exceptions | ABP |
| cs-test-blocking | `.Result`/`.Wait()` in tests | `await` | Hides deadlocks the production path would hit | AG |
| cs-test-ct | xUnit v3 test calling async APIs with `CancellationToken.None` or no token | `TestContext.Current.CancellationToken` | Timed-out tests stop sooner | XU3 |
| cs-test-time | Code under test reads `DateTime.Now`/`UtcNow` | `TimeProvider` injected, `FakeTimeProvider` in tests | Deterministic time | TIME |
| cs-test-logic | Loops, conditionals or several Act steps in one test | Split; parameterize with `[Theory]` data | A bug in the test hides a bug in the code | UT |
| cs-test-infra | Unit test touching a real database, network or file system | Fake the dependency; real infrastructure goes in integration tests (`WebApplicationFactory`, Testcontainers) | Slow and non-deterministic unit tests | UT, `csharp-testing` |
| cs-test-naming | Test names not stating method, scenario and expected result | `Method_Scenario_Expected` | Failures read as specifications | UT, `csharp-testing` |
| cs-test-span-assert | C# 14 upgrade: `Assert.Equal` with collection expressions or arrays now ambiguous | `.AsSpan()` or typed arguments | First-class span overloads | BRK14 |

## 5. Version-gated modern features

Gate on the target framework and `<LangVersion>`, never on the newest SDK.
Do not set `LangVersion` to `latest` (machine-dependent builds), and do not
raise it above the target framework's default: C# 14 on a target below
net10.0 is an unsupported configuration (LV, BRK14). Never suggest C# 15 or
other preview features (`LangVersion preview`, CA2252).

| Version | Suggest | Old form still right when | Source |
|---|---|---|---|
| C# 10 (.NET 6, out of support) | File-scoped namespaces, `global using`, record structs, `CallerArgumentExpression` (enables `ThrowIfNull` messages), constant interpolated strings, extended property patterns | Project style keeps block namespaces (IDE0161 not configured) | WN version history |
| C# 11 (.NET 7, out of support) | Raw string literals, `required` members, list patterns, generic math, UTF-8 literals, `file`-local types | Constructor parameters already enforce the invariant | WN version history, NRT |
| C# 12 (.NET 8 LTS, ends 2026-11-10) | Primary constructors, collection expressions (`[1, 2]`, spread `..`), alias any type, `ref readonly` parameters, `[Experimental]` | Non-record primary constructors generate no properties, and a parameter used in members becomes a captured private field: keep an explicit constructor when the field must be declared `readonly` or the value validated. Interceptors were preview: do not use | WN C# 12, https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/instance-constructors |
| C# 13 (.NET 9 STS, ends 2026-11-10) | `params` collections (`params ReadOnlySpan<T>`), `System.Threading.Lock` with `lock`, `\e`, partial properties and indexers, `OverloadResolutionPriority` for library authors | Keep `object` locks when the lock object is exposed or cast to `object` (falls back to `Monitor`). `field` was preview in C# 13: do not use | WN C# 13, LOCK |
| C# 14 (.NET 10 LTS, to 2028-11-14) | `field` in accessors, null-conditional assignment (`a?.B = x`), extension members (properties, static extensions), implicit span conversions, `nameof` of unbound generics, modifiers on simple lambda parameters, partial constructors and events, user-defined compound assignment | Classic `this` extension methods need no rewrite; keep an explicit backing field when other members use it; keep an `if` when the null branch must do something | WN C# 14, BRK14 |
| C# 15 (preview with .NET 11, RC2 2026-10-13) | Nothing: union types, closed hierarchies, collection expression arguments, extension indexers and labeled `break`/`continue` are preview | Always, until .NET 11 ships and the project targets it | WN C# 15, POL |

Runtime and library features follow the target framework: `ThrowIfNull`
(.NET 6), `TimeProvider` (.NET 8), `System.Threading.Lock` (.NET 9),
`BinaryFormatter` throwing (.NET 9), EF Core `ExecuteUpdate` (EF Core 7) and
`FromSql` (EF Core 7; `FromSqlInterpolated` below that) (CA1510, TIME, LOCK,
BINF, EF).

## 6. Concurrency model

- The compiler turns an `async` method into a state machine; it runs
  synchronously until the first `await` on an incomplete awaitable, so
  `async` alone does not move work to another thread — TAP, TAPI.
- Exceptions inside an `async` method are stored on the returned task and
  surface at `await`; argument (usage) errors should throw before the task is
  returned — TAP, EXBP.
- `await` captures the current `SynchronizationContext` (or `TaskScheduler`)
  and resumes on it. UI frameworks and classic ASP.NET run one continuation
  at a time on their context, so blocking that thread on a task that needs
  the context deadlocks. Console apps and ASP.NET Core have no such context —
  ABP, CAFAQ.
- ASP.NET Core runs requests on thread-pool threads. Blocking those threads
  (sync over async, sync I/O, long `lock` waits) starves the pool: queued
  work waits while the runtime adds threads gradually. A thread count that
  settles above about three times the core count usually means blocking code.
  Diagnose with `dotnet-counters` (`dotnet.thread_pool.thread.count`, queue
  length) and, on .NET 9+, the `WaitHandleWait` event — TPS, ASPP.
- Each request has its own DI scope; scoped services and `HttpContext` are
  used by one request at a time and are not thread-safe. Singletons are
  shared by every concurrent request and must synchronize their own state —
  DI, ASPP, EF `dbcontext-configuration`.
- Every `await` is a point where other requests run; state read before it
  may be stale after it. A check-then-act split by an `await` is a race;
  re-read, serialize per key, or use a database constraint.
- `lock` cannot contain `await`; use an async primitive. On .NET 9+ lock a
  dedicated `System.Threading.Lock` — LOCK.
- Several processes or pods share no memory: an in-process lock, cache or
  rate limiter does not coordinate across instances.
- Correctness vs speed: a deadlock, race, lost update or swallowed
  cancellation is 4.3; work that is only slow (an extra `Task.Run`, tracking
  on a read-only query) is 4.4.

## 7. Linter mapping

Run the project's own checks first (`.editorconfig`, `Directory.Build.props`
with `AnalysisLevel`/`AnalysisMode`/`TreatWarningsAsErrors`/`Nullable`,
`lefthook.yml`, CI results via `gh pr checks`) and pass their output to the
review; never report "no issues" from a tool that did not run. `dotnet
build`, `dotnet format` and `dotnet test` restore packages, run MSBuild
targets and load analyzers from the project; FMT says to invoke `dotnet
format` only against trusted code. On a diff you did not write, name the
command for a human instead of running it; `dotnet format whitespace
--folder --verify-no-changes` treats the path as a plain folder of files and
is the only check here that does not load the project. Do not restate what a
tool that ran already reported.

Analyzer configuration (CA, MSB): CA rules ship with the SDK and are on for
net5.0+. `AnalysisMode` sets how many are build warnings — `None`, `Default`
(a small set), `Minimum`, `Recommended`, `All` — or use a compound
`<AnalysisLevel>latest-Recommended</AnalysisLevel>`. Pin `AnalysisLevel` to
a version so an SDK upgrade adds no new warnings. IDE (code-style) rules do
not run in command-line builds unless `EnforceCodeStyleInBuild` is `true`.
Nullable warnings are compiler diagnostics (the CS86xx family, for example
CS8600–CS8604, CS8618, CS8625) and need no analyzer (NRTW). "Default in .NET 10" below is from each rule page.

| Item | Rule | Default in .NET 10 |
|---|---|---|
| cs-null-forgiving, cs-nullable-off, cs-required | CS8600–CS8604, CS8618, CS8625 | compiler warnings when `<Nullable>enable` |
| cs-nullable-runtime | CA1062; CA1510 | no; suggestion |
| cs-string-compare | CA1307, CA1309, CA1310; CA1862 | no; suggestion |
| cs-format-culture | CA1305 | no |
| cs-dispose | CA2000, CA1001, CA2213 | no |
| cs-dispose-pattern | CA1063; CA1816 | no; suggestion |
| cs-ignored-result | CA1806 | suggestion |
| cs-catch-general | CA1031 | no |
| cs-rethrow | CA2200 | warning |
| cs-throw-type | CA2201; CA2208 | no; suggestion |
| cs-throw-helper | CA1510; CA1871; CA2264 | suggestion; information; warning |
| cs-sync-io-in-async | CA1849; CA2024 | no; warning |
| cs-fire-forget | CA2025 | no |
| cs-ct-flow | CA2016; CA1068 | suggestion |
| cs-configureawait (libraries) | CA2007 | no |
| cs-valuetask | CA2012 | suggestion |
| cs-continuewith | CA2008 | no |
| cs-lock-target (.NET 9+) | IDE0330 | style rule |
| cs-multi-enum | CA1851 | no |
| cs-count-any | CA1827, CA1829, CA1860 | suggestion |
| cs-dict-lookup | CA1854, CA1864 | suggestion |
| cs-json-options | CA1869 | suggestion |
| cs-log-template | CA2254; CA1848; CA1873 | suggestion; no; suggestion |
| cs-stackalloc-loop | CA2014 | warning |
| cs-param-type (internal) | CA1859 | suggestion |
| cs-preview | CA2252 | error |
| cs-sql-raw | CA2100, CA3001 | no |
| cs-deserialize | CA2300, CA2326 | no |
| cs-crypto | CA5394, CA5350, CA5351, CA5359 | no |
| cs-casing, cs-underscores | IDE1006 (with `.editorconfig` naming rules); CA1707 | style rule; no |
| cs-unused, cs-modern-style, cs-braces | IDE0005, IDE0059, IDE0060, IDE0161, IDE0290, IDE0300, IDE0011 | style rules |
| formatting | `dotnet format --verify-no-changes` (whitespace, style, analyzers subcommands) | — |

No tool decides: whether a `catch` should swallow, whether code is library
or app code (ConfigureAwait), whether a path is hot, whether a `!` is
justified, N+1 behind a navigation property, DI lifetime fit, the fan-out
bound, or whether a version gate applies. Those are the review's work.
