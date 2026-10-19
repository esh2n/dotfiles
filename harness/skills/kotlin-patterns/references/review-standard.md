# Kotlin review standard

The one Kotlin standard (JVM server, Android, Kotlin Multiplatform) for both
the model writing Kotlin and `code-reviewer` reviewing a Kotlin diff. It
lists what to check and where the rule comes from; detail and code live in
the skills it links: `kotlin-patterns` (idioms, sealed types, DSLs, Gradle),
`kotlin-coroutines-flows` (scopes, Flow operators, dispatchers),
`kotlin-testing` (Kotest, MockK, `runTest`, Kover),
`compose-multiplatform-patterns` (state, navigation, Compose performance),
`android-clean-architecture` (modules, UseCases, repositories),
`kotlin-ktor-patterns` (Ktor server), `kotlin-exposed-patterns` (Exposed,
transactions). Layering questions go to `clean-architecture`; SQL text and
plans to `sql-tuning/references/review-standard.md`; exported components,
WebView, crypto and secrets to `security-reviewer`.

Before applying any rule, read from the build files as text (never run
Gradle on a diff: it evaluates `build.gradle.kts`, `settings.gradle.kts`,
`buildSrc` and convention plugins as code): the Kotlin plugin version, the
`kotlinx-coroutines` version, `jvmToolchain`/`jvmTarget`, and for Android
`minSdk`/`compileSdk` and whether the Compose compiler plugin
(`org.jetbrains.kotlin.plugin.compose`) is applied. A rule gated on a version
does not apply below it. Language features marked experimental, preview or
beta need the matching `-X` flag in `freeCompilerArgs`; do not suggest them
otherwise.

Sources are cited by the short name in the first column of section 1; a
quoted topic after it (for example KCC "Immutability") names the section of
that page.

## 1. Sources

| Short | Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|---|
| KCC | Kotlin coding conventions | https://kotlinlang.org/docs/coding-conventions.html | Naming, immutability, default parameters, platform types, expression `if`/`when`/`try`, functions vs properties, loops, named arguments, library conventions | Fetched 2026-10-19 | Apache-2.0 (JetBrains/kotlin-web-site) |
| KDOC | Kotlin language docs: Null safety, Calling Java from Kotlin, Numbers, Inline functions, Sequences, Functions, Collections overview, Sealed classes, Exceptions, API guidelines (simplicity), Gradle compiler options | https://kotlinlang.org/docs/null-safety.html, https://kotlinlang.org/docs/java-interop.html, https://kotlinlang.org/docs/numbers.html, https://kotlinlang.org/docs/inline-functions.html, https://kotlinlang.org/docs/sequences.html, https://kotlinlang.org/docs/functions.html, https://kotlinlang.org/docs/collections-overview.html, https://kotlinlang.org/docs/sealed-classes.html, https://kotlinlang.org/docs/exceptions.html, https://kotlinlang.org/docs/api-guidelines-simplicity.html, https://kotlinlang.org/docs/gradle-compiler-options.html | `!!`, platform types `T!`, JSpecify, boxing of `Int?` and generics, sequence overhead, top-level functions, read-only vs mutable collections, exhaustive `when`, `require`/`check`, explicit API mode, `allWarningsAsErrors` | Fetched 2026-10-19 | Apache-2.0 |
| KCO | Kotlin coroutines guide: Coroutines basics, Cancel coroutines, Coroutine exceptions handling, Coroutine context and dispatchers, Shared mutable state and concurrency, Flows | https://kotlinlang.org/docs/coroutines-basics.html, https://kotlinlang.org/docs/coroutines-cancellation.html, https://kotlinlang.org/docs/exception-handling.html, https://kotlinlang.org/docs/coroutine-context-and-dispatchers.html, https://kotlinlang.org/docs/shared-mutable-state-and-concurrency.html, https://kotlinlang.org/docs/coroutines-flow.html | Structured concurrency, `runBlocking`, cooperative cancellation, `runInterruptible`, `NonCancellable`, timeouts, handler and supervision rules, `@Volatile`, confinement, `Mutex`, cold vs hot flows | Cancellation page dated 2026-07-27; old URLs (`cancellation-and-timeouts.html`, `flow.html`) redirect | Apache-2.0 |
| KXC | kotlinx.coroutines API reference: `GlobalScope`, `runBlocking`, `Dispatchers.Default`, `Dispatchers.IO`, `limitedParallelism`, `Mutex`, `Channel`, `Flow`, `flow`, `flowOn`, `flatMapMerge`, `StateFlow`, kotlinx-coroutines-test | https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/ (pages per symbol), https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-test/ | API contracts: delicate `GlobalScope`, `runBlocking` inside `suspend` is wrong, pool sizes, non-reentrant `Mutex`, unlimited channels, context preservation, exception transparency, `StateFlow` equality conflation, `runTest`/`setMain` | kotlinx-coroutines 1.11.0 (version shown on the test page) | Apache-2.0 |
| KWN | Kotlin "What's new" 2.0.0, 2.0.20, 2.1.0, 2.2.0, 2.3.0, 2.4.0, 2.4.20; Kotlin releases | https://kotlinlang.org/docs/whatsnew20.html (and `whatsnew2020`, `whatsnew21`, `whatsnew22`, `whatsnew23`, `whatsnew24`, `whatsnew2420`), https://kotlinlang.org/docs/releases.html | Version-gated language and stdlib features and their stability | Latest 2.4.21 (2026-10-08) | Apache-2.0 |
| ASG | Android Kotlin style guide | https://developer.android.com/kotlin/style-guide | Wildcard imports, naming, backing properties, implicit types | Fetched 2026-10-19 | CC BY 4.0 (text), Apache-2.0 (code) |
| ACO | Android: Best practices for coroutines | https://developer.android.com/kotlin/coroutines/coroutines-best-practices | Inject dispatchers, main-safe suspend functions, ViewModel creates coroutines, no exposed mutable types, avoid `GlobalScope`, cancellable loops, never swallow `CancellationException` | Fetched 2026-10-19 | CC BY 4.0 |
| AFL | Android: StateFlow and SharedFlow; Lifecycle-aware coroutines | https://developer.android.com/kotlin/flow/stateflow-and-sharedflow, https://developer.android.com/topic/libraries/architecture/coroutines | `repeatOnLifecycle`, never collect UI flows with bare `launch`, `stateIn`/`shareIn`, `collectAsStateWithLifecycle` | Fetched 2026-10-19 | CC BY 4.0 |
| AVM | Android: ViewModel overview | https://developer.android.com/topic/libraries/architecture/viewmodel | No `Context`/`Resources` references in a ViewModel, do not pass ViewModels down | Fetched 2026-10-19 | CC BY 4.0 |
| CMP | Compose docs: Stability, Strong skipping, Performance best practices, Side-effects, State, Lists, Navigation ("Expose events from your composables") | https://developer.android.com/develop/ui/compose/performance/stability, https://developer.android.com/develop/ui/compose/performance/stability/strongskipping, https://developer.android.com/develop/ui/compose/performance/bestpractices, https://developer.android.com/develop/ui/compose/side-effects, https://developer.android.com/develop/ui/compose/state, https://developer.android.com/develop/ui/compose/lists, https://developer.android.com/guide/navigation/use-graph/navigate | Stability inference, strong skipping (default since Kotlin 2.0.20), `remember`, keys, `derivedStateOf`, deferred reads, backwards writes, effect keys, `onDispose`, mutable collections as state, lambdas instead of `NavController` | Fetched 2026-10-19 | CC BY 4.0 |
| DTK | detekt rule sets: coroutines, exceptions, performance, potential-bugs, style | https://detekt.dev/docs/rules/coroutines (and `/exceptions`, `/performance`, `/potential-bugs`, `/style`) | Rule names and default activation | Docs show 2.0.0-alpha.6; latest stable line 1.23.x. Rule names checked against the 2.0 docs | Apache-2.0 |
| KTL | ktlint standard rules | https://ktlint.github.io/ktlint/latest/rules/standard/ | Formatting and naming rules (`no-wildcard-imports`, `property-naming`, `backing-property-naming`, `function-naming`, `filename`) | ktlint 1.8.0 (latest GitHub release); repo moved to `ktlint/ktlint` | MIT |
| ALI | Android Lint issue index | https://googlesamples.github.io/android-custom-lint-rules/checks/index.md.html | Issue IDs (Compose, lifecycle, security, API level) | Fetched 2026-10-19 | Apache-2.0 |
| HIB | Hibernate ORM User Guide | https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html | `hibernate.default_batch_fetch_size`, `hibernate.jdbc.batch_size`, IDENTITY disables insert batching, N+1 | 7.4.13.Final | Apache-2.0 (Hibernate 7; licence page not opened) |
| EXP | Exposed: DAO relationships | https://www.jetbrains.com/help/exposed/dao-relationships.html | Eager loading with `.load()` / `.with()` against N+1 | Fetched 2026-10-19 | Apache-2.0 (licence page not opened) |
| JEP491 | JEP 491: Synchronize Virtual Threads without Pinning | https://openjdk.org/jeps/491 | `synchronized` no longer pins virtual threads | Delivered in JDK 24 | OpenJDK terms |

Licences were taken from the projects' repositories as known; only the
licence notes marked "not opened" are flagged, and none of the licence pages
was re-opened in this run.

## 2. Mindset

- Let the type system carry nullability: model absence with `T?` and handle
  it with `?.`, `?:`, `let`; `!!` is a claim the compiler cannot check (KDOC
  Null safety).
- `val` and read-only collection interfaces by default; mutation stays
  inside the class that owns it (KCC "Immutability", ACO "Don't expose
  mutable types").
- Expression forms of `if`, `when`, `try`; sealed hierarchies with
  exhaustive `when` instead of an `else` that hides new cases (KCC
  "Conditional statements", KDOC Sealed classes).
- Every coroutine has a scope that owns its lifetime and cancellation;
  `suspend` functions are main-safe and cancellable (KCO basics, ACO).
- Cancellation is an exception that must travel up: never swallow
  `CancellationException` (ACO "Watch out for exceptions").
- In Compose, state goes down and events go up; composables are free of
  side effects (CMP State, Side-effects).
- Performance findings need an execution context and a frequency; idioms
  that look expensive are often inlined or skipped (KDOC Inline functions,
  CMP Strong skipping).

## 3. Habits carried from other languages

| Habit | Do instead | Source |
|---|---|---|
| `var` locals and fields left mutable by default (Java) | `val` unless reassigned | https://kotlinlang.org/docs/coding-conventions.html#immutability |
| `ArrayList`/`MutableList` in signatures and return types (Java) | Read-only `List`/`Set`/`Map`; `listOf()` over `arrayListOf()` | KCC "Immutability", https://kotlinlang.org/docs/collections-overview.html |
| Telescoping overloads (Java) | Default parameter values; named arguments at call sites with several same-typed or Boolean parameters | https://kotlinlang.org/docs/coding-conventions.html#default-parameter-values, #named-arguments |
| Trusting Java return values as non-null, or leaking `T!` from public API | Declare the Kotlin type explicitly on public functions and class-level properties initialised from Java | https://kotlinlang.org/docs/coding-conventions.html#platform-types, https://kotlinlang.org/docs/java-interop.html#null-safety-and-platform-types |
| Static utility classes holding functions (Java) | Top-level functions | https://kotlinlang.org/docs/functions.html |
| `getX()` methods for cheap, non-throwing reads (Java beans) | A property; keep a function when it throws, is costly, or not idempotent | https://kotlinlang.org/docs/coding-conventions.html#functions-vs-properties |
| `+` string concatenation, `\n` inside strings | String templates; raw strings with `trimIndent()` | https://kotlinlang.org/docs/coding-conventions.html#strings |
| Checked-exception thinking: catch-all `catch (e: Exception)` around everything | Catch specific types; precondition with `require`/`check`/`error` | https://kotlinlang.org/docs/exceptions.html, ACO "Watch out for exceptions" |
| `Thread.sleep`, thread pools and `synchronized` for async work (Java) | `delay`, structured scopes, `Mutex.withLock` | KCO shared mutable state, DTK `SleepInsteadOfDelay` |
| `IClickable` interface prefixes, wildcard imports (C#, Java) | Plain names; explicit imports | ASG "Import statements", KTL `no-wildcard-imports` |

## 4. Review items

Format: `id` — trigger visible in a diff — what to check — why — source.
One-line items are general knowledge; detail appears only where judgment or
a threshold is involved. A finding names the concrete failure; "might leak"
is not a finding.

### 4.1 Correctness and null safety

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| kt-not-null-assert | `!!` | Replace with `?.`/`?:`, `requireNotNull`/`checkNotNull` with a message, or a smart cast; keep `!!` only where a non-null invariant is stated nearby | NPE with no context | KDOC Null safety "Not-null assertion operator", DTK `UnsafeCallOnNullableType` |
| kt-platform-type | Public function or property whose value comes from a Java call with no declared type | Declare `T` or `T?` explicitly; check the Java side's nullability annotations (JSpecify) | `T!` moves the NPE to the caller | KCC "Platform types", KDOC Calling Java "Null-safety and platform types" |
| kt-lateinit | New `lateinit var` read on a path that can run before assignment | Constructor injection, `by lazy`, or nullable | `UninitializedPropertyAccessException` | KDOC Null safety, DTK `LateinitUsage` |
| kt-exhaustive-when | `when` over a sealed type or enum with an `else` branch | Drop `else` so a new subtype is a compile error | `else` silently absorbs new cases | KDOC Sealed classes, DTK `ElseCaseInsteadOfExhaustiveWhen` |
| kt-referential-eq | `===` on boxed numbers or strings | `==` | Boxed `Integer` cache (-128..127) makes `===` pass in tests and fail in production | KDOC Numbers, DTK `AvoidReferentialEquality` |
| kt-mutable-state-holder | `MutableStateFlow`/`StateFlow` holding a mutable collection or a class with `var` fields, mutated in place | Replace the value: `_state.update { it.copy(items = it.items + x) }` | `StateFlow` conflates by `equals`; in-place mutation may emit nothing | KXC `StateFlow`, CMP State |
| kt-double-mutability | `var x = mutableListOf()` | One kind of mutability | Two ways to change the same state | DTK `DoubleMutabilityForCollection` |
| kt-ignored-result | Call to a pure function (`copy`, `plus`, `map`, `trim`) whose result is unused | Use the result | Read-only collections and data classes do not change in place | DTK `IgnoredReturnValue`; KWN 2.3 unused return value checker (experimental) |

### 4.2 Errors

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| kt-swallow-cancel | `catch (e: Exception)`/`Throwable` or `runCatching { … }` around a suspend call | Rethrow `CancellationException` first, or catch narrower types | The coroutine keeps running after its scope was cancelled | ACO "Watch out for exceptions", DTK `SuspendFunSwallowedCancellation` |
| kt-generic-catch | Catch of `Exception`/`Throwable`/`RuntimeException` outside a top-level boundary | Catch what the callee documents | Hides bugs and cancellation | DTK `TooGenericExceptionCaught`, ACO |
| kt-swallowed | Empty catch, or catch that logs and continues | Handle, rethrow with cause, or return a typed failure | Lost failures | DTK `SwallowedException` |
| kt-preconditions | `if (x == null) throw IllegalArgumentException(…)` | `require`/`requireNotNull` for arguments, `check`/`checkNotNull` for state, `error()` for impossible states | Correct exception type, shorter | KDOC Exceptions "Preconditions", DTK `UseRequire`, `UseCheckOrError` |
| kt-handler-placement | `CoroutineExceptionHandler` passed to a child `launch` or to `async` | Install it on the root coroutine or a direct child of a supervisor scope; `async` failures surface at `await()` | A handler on a child is never used | KCO exceptions "CoroutineExceptionHandler" |
| kt-supervision | Sibling tasks where one failure must not cancel the others, written with `coroutineScope`/`Job()` | `supervisorScope`/`SupervisorJob`, each child handles its own errors | In a regular scope a child failure cancels the parent and siblings | KCO exceptions "Supervision" |
| kt-finally-suspend | Suspend call inside `finally` | Wrap in `withContext(NonCancellable)` | After cancellation the call throws immediately and cleanup is skipped | KCO cancellation "Run non-cancelable blocks", DTK `SuspendFunInFinallySection` |
| kt-noncancellable-misuse | `launch(NonCancellable)` / `async(NonCancellable)` | Only `withContext(NonCancellable)` | Breaks the parent-child relation | KCO cancellation "Run non-cancelable blocks" |

### 4.3 Coroutines and Flow

Correctness rules here; speed rules in 4.4. A finding names the scope, the
dispatcher and the failure (leak, hang, lost cancellation, crash).

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| kt-global-scope | `GlobalScope.launch/async`, or `CoroutineScope(...).launch` created ad hoc | Make the function `suspend`, use `coroutineScope`, or an injected scope with a defined owner. `GlobalScope` only for application-lifetime work with `@OptIn(DelicateCoroutinesApi::class)` | No cancellation, no waiting, leaked work | KXC `GlobalScope`, ACO "Avoid GlobalScope", DTK `GlobalCoroutineUsage` |
| kt-scope-owner | New `CoroutineScope` field or `launch` in a class | Name who cancels it (`viewModelScope`, `lifecycleScope`, a `close()` that cancels) | Work outlives its owner | KCO basics "Coroutine scope and structured concurrency", AVM |
| kt-run-blocking | `runBlocking` inside a `suspend` function, a request handler or on the Android main thread | Call the suspend function directly; `runBlocking` only in `main`, tests, or a non-suspend callback with no other option | Blocks the thread; thread starvation; on the main thread an ANR | KXC `runBlocking`, KCO basics "runBlocking()" |
| kt-blocking-in-suspend | JDBC, `File.read*`, `Thread.sleep`, OkHttp `execute()`, `BlockingQueue.take()` in a `suspend` function without a dispatcher switch | `withContext(Dispatchers.IO)` (inject the dispatcher), or a suspending API; `runInterruptible` when the blocking call must react to cancellation | Suspend functions must be main-safe; blocking code ignores cancellation | ACO "Suspend functions should be main-safe", KCO cancellation "Interrupt blocking code", DTK `SleepInsteadOfDelay` |
| kt-cancellable-loop | Long CPU loop in a coroutine with no suspension point | `ensureActive()`/`isActive` or `yield()` per iteration | Cancellation is cooperative; the loop runs on after cancel | KCO cancellation "Make coroutines react to cancellation", ACO |
| kt-inject-dispatcher | `Dispatchers.IO`/`Default` hard-coded in `withContext` or `launch` in testable code | Constructor-injected `CoroutineDispatcher` | Tests cannot substitute a `TestDispatcher` | ACO "Inject Dispatchers", DTK `InjectDispatcher` |
| kt-kmp-io | `Dispatchers.IO` in `commonMain` | Inject a dispatcher; use `Default` or a platform-provided one | `Dispatchers.IO` exists only on JVM/Native targets, not JS/Wasm | KXC `Dispatchers.IO` (unverified for per-target availability: page not checked for platform list) |
| kt-flow-context | `withContext(...) { emit(x) }` or `launch { emit(x) }` inside `flow { }` | `flowOn` for the upstream, `channelFlow` for concurrent emission | `IllegalStateException`: flows preserve the collector's context | KXC `flow`, `Flow`, `flowOn` |
| kt-flow-transparency | `try { emit(x) } catch (e: Exception) { … }` inside a flow builder | The `catch` operator for upstream errors; never keep emitting after a downstream exception | Downstream exceptions get swallowed; the runtime throws on the next emit | KXC `Flow` "Exception transparency" |
| kt-flow-cancellable | `asFlow()` or a custom flow over a long sequence collected where cancellation matters | Add `.cancellable()` | Only `flow { }` and `SharedFlow` check cancellation on each emission | KXC `Flow` |
| kt-flow-return | `suspend fun x(): Flow<T>` | Drop `suspend`; the flow is cold | Mixes two models; callers cannot build the flow without suspending | DTK `SuspendFunWithFlowReturnType` |
| kt-hot-flow-scope | `stateIn`/`shareIn` in a scope that outlives the consumers, or `SharingStarted.Eagerly` on a UI stream | A scope that lives longer than consumers but ends with its owner; `WhileSubscribed(...)` for UI state | Hot flows keep collecting upstream until the sharing scope is cancelled | KCO Flows "Cancel hot flows", AFL |
| kt-expose-mutable | Public `MutableStateFlow`/`MutableSharedFlow`/`MutableList` | Private mutable backing property, public read-only type (`asStateFlow()`), or an explicit backing field (2.4 stable) | State changes leave the owning class | ACO "Don't expose mutable types", KCC "Names for backing properties", KWN 2.4 |
| kt-shared-mutable | Plain `var` or non-thread-safe collection mutated from coroutines on `Default`/`IO` | `AtomicX`, `Mutex.withLock`, or confinement to one thread (coarse-grained) | Lost updates; `@Volatile` does not make `x++` atomic | KCO "Shared mutable state and concurrency" |
| kt-mutex-reentry | `mutex.withLock { … }` that calls another function taking the same `Mutex` | Restructure; `Mutex` is not reentrant | Suspends forever | KXC `Mutex` |
| kt-scope-receiver | `suspend fun CoroutineScope.x()` | Either `suspend fun x()` with `coroutineScope { }` inside, or a non-suspend `CoroutineScope.x()` that launches | Ambiguous which scope children belong to | DTK `SuspendFunWithCoroutineScopeReceiver` |

### 4.4 Performance

Report only on paths that run often (request path, per element, per frame);
say so when the code is cold and skip it. Tag each finding `static` (holds
without measurement) or `needs-measurement`, and name the command a human
would run (JMH via the project's benchmark plugin, async-profiler `-e alloc`
for allocation claims, `-e lock` for contention, Compose compiler reports for
stability). Never call a performance claim verified without a before/after
measurement of the stated mechanism. Never run Gradle or a benchmark on a
diff yourself.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| kt-dispatcher-fit | Blocking I/O on `Dispatchers.Default`, or CPU-heavy loops on `Dispatchers.IO` | Blocking work on `IO` (or a `limitedParallelism` view of it); computation on `Default` | `Default` has as many threads as CPU cores (at least two), so one blocked thread stalls unrelated work; `IO` defaults to max(64, cores) threads | KXC `Dispatchers.Default`, `Dispatchers.IO` |
| kt-withcontext-loop | `withContext` inside a per-item loop | One `withContext` around the loop; note `IO`↔`Default` switches often stay on the same thread | Repeated dispatch for no gain | KXC `Dispatchers.IO`, KCO shared state "Thread confinement coarse-grained" |
| kt-serial-await | Independent suspend calls awaited one after another on a latency-bound path | `coroutineScope { async {…}; async {…} }` and `awaitAll`. Flag only when independence is visible in the diff | Latency adds up | KCO basics "CoroutineScope.async()" |
| kt-unbounded-fanout | `items.map { async { … } }.awaitAll()` over a data-controlled list; `flatMapMerge` over an unbounded upstream | Bound it: `Dispatchers.IO.limitedParallelism(n)`, a `Semaphore`, or an explicit `concurrency =`; name the bound | Connection and memory exhaustion grows with input | KXC `limitedParallelism`, `flatMapMerge` |
| kt-unbounded-buffer | `Channel(Channel.UNLIMITED)` or a `MutableSharedFlow` with a large buffer between a fast producer and a slow consumer | Bounded capacity with a stated overflow policy (`SUSPEND`, `DROP_OLDEST`) | An unlimited channel never suspends the sender; memory grows with the lag | KXC `Channel`, AFL "SharedFlow" |
| kt-boxing | `List<Int>`, `Map<Int, Long>`, `Int?`, `Sequence<Double>` on a hot numeric path | `IntArray`/`LongArray`, ranges, primitive-specialised collections. Not a finding in DTOs, config or once-per-request values | Generic and nullable numbers are boxed objects | KDOC Numbers, DTK `ArrayPrimitive` |
| kt-compose-autobox | `mutableStateOf<Int>(…)`, `mutableStateOf<Float>(…)` | `mutableIntStateOf`, `mutableFloatStateOf` … | Boxes every assignment | ALI `AutoboxingStateCreation`, `AutoboxingStateValueProperty` |
| kt-inline-hot | Hand-written higher-order function called in a hot loop | Consider `inline` (not for large bodies); check `noinline`/`crossinline` before asserting | Non-inline lambdas allocate function objects and closures | KDOC Inline functions |
| kt-sequence-fit | Multi-step `map`/`filter`/`take` chain over a large collection, or `asSequence()` on a small one | Sequence for multi-step processing of large or lazy data; eager chain for small collections or one step. Either suggestion needs a size argument | Eager chains allocate an intermediate list per step; sequences add overhead that matters on small inputs | KDOC Sequences, DTK `CouldBeSequence` |
| kt-collection-shortcut | `filter { }.first()`, `filter { }.size`, `map { }.firstOrNull()`, `sortedBy { }.first()` | `first { }`, `count { }`, `firstNotNullOfOrNull`, `minByOrNull` | Avoids intermediate collections and full sorts | DTK `UnnecessaryFilter`, `UseAnyOrNoneInsteadOfFind`, `RedundantHigherOrderMapUsage` |
| kt-n-plus-one | Loop over entities dereferencing a lazy JPA association or Exposed reference | `JOIN FETCH`/entity graph, or Exposed `.with()`/`.load()`; with unavoidable lazy loading, `hibernate.default_batch_fetch_size` or `@BatchSize`. `FetchType.EAGER` on the mapping is not the fix | One query per row | HIB "Fetch Related Settings", EXP "Loading collections" |
| kt-jdbc-batch | `save`/`persist` per entity in a loop | `hibernate.jdbc.batch_size` set, and an ID generator other than `IDENTITY` | `IDENTITY` disables insert batching | HIB "JDBC Batch Settings", "Identifier generators" |
| kt-vthread-pinning | `synchronized`/`@Synchronized` finding on code running on virtual threads | State the JDK: pinning is real below 24, gone at 24+ | JEP 491 removed nearly all pinning | JEP491 |
| kt-compose-remember | Sorting, filtering, formatting or object creation in a composable body | `remember(keys) { … }` or move to the ViewModel | Runs on every recomposition | CMP Best practices "Use remember" |
| kt-compose-lazy-keys | `LazyColumn`/`LazyRow` `items(list)` without `key` on a list that reorders or inserts | `key = { it.id }` with a stable unique id | Items lose remembered state and recompose on moves | CMP Best practices "Use lazy layout keys", CMP Lists "Item keys" |
| kt-compose-non-lazy | `Column { items.forEach { … } }` with `verticalScroll` over a data-controlled list | `LazyColumn` | Composes every element; cost grows with the dataset | CMP Lists |
| kt-compose-derived | Frequently changing state (scroll offset, text) feeding a rarely changing Boolean read in composition | `derivedStateOf`; not for simple combinations like `"$first $last"` | Recomposes per frame instead of per transition | CMP Best practices, Side-effects "derivedStateOf", ALI `FrequentlyChangedStateReadInComposition` |
| kt-compose-defer-read | Fast-changing state read high in the tree or passed as a value to an offset/draw modifier | Pass `() -> T`; use lambda modifiers (`Modifier.offset { }`, `drawBehind`) | Moves the read to layout/draw so composition is skipped | CMP Best practices "Defer reads" |
| kt-compose-stability | Proposal to add `@Stable`/`@Immutable`, `ImmutableList`, or `remember` around lambdas | Check that strong skipping is on (default from Kotlin 2.0.20) and read the compiler reports first. Under strong skipping, unstable parameters compare by `===` and lambdas are memoised; annotate only when structural equality is needed and `equals` is cheap. Annotating a type that is not immutable is a correctness bug | The old instability advice mostly no longer applies; element-wise `equals` can cost more than recomposition | CMP Stability, Strong skipping, KWN 2.0.20 |

### 4.5 API design

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| kt-explicit-api | New public declaration in a library module | Explicit visibility and explicit return/property types; consider explicit API mode | Accidental public API | KCC "Coding conventions for libraries", KDOC API guidelines "Use explicit API mode" |
| kt-defaults-over-overloads | Several overloads differing only in trailing parameters | Default parameter values | Fewer declarations | KCC "Default parameter values" |
| kt-named-args | Call with several same-typed or Boolean positional arguments | Named arguments | Swapped arguments compile | KCC "Named arguments" |
| kt-function-vs-property | Property getter that throws, is costly, or changes per call; or a no-arg function that is a cheap read | Function for the first, property for the second | Callers assume properties are cheap | KCC "Functions vs properties" |
| kt-sealed-results | Error states modelled as nullable plus flags or as exceptions for expected cases | Sealed interface or `Result` | Exhaustive handling | KDOC Sealed classes, `kotlin-patterns` "Sealed Interfaces for API Responses" |
| kt-suspend-and-flow | Data or domain layer returning callbacks or starting its own coroutines | `suspend` for one-shot calls, `Flow` for streams; an injected external scope only for work that must outlive the caller | Callers control execution and cancellation | ACO "The data and business layers should expose suspend functions and Flows" |
| kt-extension-scope | Extension on `Any` or a very generic type, or a file holding all extensions of a class | Place extensions with the class or next to their only client | Pollutes completion; hidden coupling | KCC "Extension functions" |
| kt-redundant-suspend | `suspend` on a function that never suspends | Remove it | Misleads callers | DTK `RedundantSuspendModifier` |

### 4.6 Android and Compose specific

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| kt-ui-collect | `lifecycleScope.launch { flow.collect { … } }` updating UI; `launchWhenStarted` | `repeatOnLifecycle(STARTED)` (with `viewLifecycleOwner` in Fragments) | Bare `launch` keeps collecting while the view is not visible and can crash | AFL, ALI `RepeatOnLifecycleWrongUsage`, `UnsafeRepeatOnLifecycleDetector` |
| kt-compose-collect | `collectAsState()` or `StateFlow.value` read in Android composables | `collectAsStateWithLifecycle()`; `collectAsState()` only in platform-agnostic (KMP common) code | Lifecycle-aware collection; `.value` does not subscribe | AFL, CMP State, ALI `StateFlowValueCalledInComposition` |
| kt-vm-context | ViewModel or singleton holding `Context`, `Activity`, `View`, `Resources`, `Lifecycle` | Pass data, not the reference; `applicationContext` only through DI where needed | Memory leak across configuration changes | AVM "Best practices", ALI `StaticFieldLeak` |
| kt-vm-passed-down | ViewModel passed into child composables or other classes | Pass state and lambdas from the screen-level composable | Lower components see more than they need | AVM "Best practices" |
| kt-vm-launches | ViewModel exposing `suspend` functions for the UI to call | ViewModel launches in `viewModelScope` and exposes state | Work survives configuration changes and is cancelled on clear | ACO "The ViewModel should create coroutines" |
| kt-compose-side-effect | Network, DB, logging or `launch` in a composable body | `LaunchedEffect`, `rememberCoroutineScope` from events, or the ViewModel | Runs on every recomposition | CMP Side-effects, ALI `CoroutineCreationDuringComposition`, `FlowOperatorInvokedInComposition` |
| kt-effect-keys | `LaunchedEffect`/`DisposableEffect` using values that are not keys; `LaunchedEffect(true)`/`(Unit)` | Add the value as a key, or read it through `rememberUpdatedState`; justify constant keys | Stale captures or needless restarts | CMP Side-effects |
| kt-dispose | `DisposableEffect` with an empty or missing `onDispose` | Undo the registration in `onDispose` | Leaked observers | CMP Side-effects |
| kt-backwards-write | State written after it was read in the same composition | Write in event handlers | Endless recomposition | CMP Best practices "Avoid backwards writes" |
| kt-compose-mutable-state | `mutableListOf()`/`ArrayList` held as Compose state, or `mutableStateOf` without `remember` | `mutableStateListOf`, or `State<List<T>>` replaced with `listOf()`; wrap in `remember`/`rememberSaveable` | Compose cannot observe the mutation; users see stale data | CMP State, ALI `MutableCollectionMutableState`, `UnrememberedMutableState` |
| kt-navcontroller-deep | `NavController` passed into composables below the nav host | Expose `() -> Unit` events; the host calls `navigate` | UDF; testable composables | CMP Navigation "Expose events from your composables" |
| kt-modifier-param | Public composable emitting UI without a `modifier: Modifier = Modifier` first optional parameter | Add it and apply it to the root | Callers cannot size or place it | ALI `ModifierParameter`, `ComposeModifierMissing` |
| kt-security-routing | New exported component, WebView JavaScript, JS interface, cleartext config, secrets in code | Route to `security-reviewer`; name the Lint ID | Security lane owns it | ALI `ExportedService`, `ExportedReceiver`, `ExportedContentProvider`, `SetJavaScriptEnabled`, `AddJavascriptInterface`, `DefaultCleartextTraffic` |

### 4.7 Naming and readability

One line each; ktlint and detekt catch most when enabled.

| id | Trigger | Check | Source |
|---|---|---|---|
| kt-const-naming | `const val` or deeply immutable top-level/object `val` not in `SCREAMING_SNAKE_CASE`, or mutable ones that are | Constants upper snake, everything else camelCase | KCC "Property names", ASG "Constant names", KTL `property-naming` |
| kt-backing-property | Private `_x` with no public `x`, or public property named `_x` | `_x` only as the private backing of a public `x` | KCC "Names for backing properties", KTL `backing-property-naming` |
| kt-acronyms | `XMLParser`, `HttpUrl` mixed styles | Two-letter acronyms upper (`IOStream`), longer capitalise the first letter (`XmlFormatter`) | KCC "Choose good names" |
| kt-expression-forms | `if`/`when`/`try` assigning a `var` in each branch | Expression form; `if` for two branches, `when` for three or more | KCC "Conditional statements", "if versus when" |
| kt-expression-body | Block body with a single `return` | Expression body | KCC "Expression bodies" |
| kt-scope-fn-nesting | Nested `?.let { … ?.let { … } }` or `apply`/`also` chains hiding control flow | Flat safe-call chain or early return | KCC "Scope functions", `kotlin-patterns` "Scope Functions" |
| kt-foreach | `forEach` on a non-nullable receiver as a statement | `for` loop | KCC "Loops" |
| kt-labeled-returns | Several labelled returns in one lambda | Restructure, or an anonymous function | KCC "Returns in a lambda" |
| kt-nullable-boolean | `if (flag ?: false)` / `if (flag!!)` on `Boolean?` | `if (flag == true)` | KCC "Nullable Boolean values in conditions" |
| kt-wildcard-import | `import a.b.*` | Explicit imports | ASG "Import statements", KTL `no-wildcard-imports`, DTK `WildcardImport` |
| kt-file-name | File with one class named differently; `Utils.kt` with mixed content | File named for the class or for what it contains | KCC "Source file names", KTL `filename` |

### 4.8 Testing

Patterns and examples: `kotlin-testing`. `test-reviewer` owns whether tests
protect behaviour; these are Kotlin forms.

| id | Trigger | Check | Source |
|---|---|---|---|
| kt-test-runtest | Test calling suspend code with `runBlocking`, or launching coroutines outside `runTest` | `runTest` (skips delays, surfaces uncaught exceptions) | KXC kotlinx-coroutines-test, DTK `CoroutineLaunchedInTestWithoutRunTest` |
| kt-test-main | Test of code using `Dispatchers.Main` with no `Dispatchers.setMain` | `Dispatchers.setMain(StandardTestDispatcher())`, reset after | KXC kotlinx-coroutines-test |
| kt-test-dispatcher | Production dispatcher used in a test; `Thread.sleep` to wait | Inject a `TestDispatcher` sharing `runTest`'s scheduler; `advanceUntilIdle`/`advanceTimeBy` | ACO "Inject TestDispatchers in tests", KXC kotlinx-coroutines-test |
| kt-test-names | Backtick test names in Android instrumented tests on API < 30 | Underscored names there | KCC "Names for test methods" |
| kt-test-fakes | Mocking repository boundaries call by call | Hand-written fakes for repositories; mocks for external services | `kotlin-testing` "Fakes Over Mocks" |

## 5. Version-gated modern features

Suggest only when the Kotlin plugin version is at or above the row, and for
non-stable features only when the project already enables the flag.

| Version | Suggest | Old form still right when |
|---|---|---|
| 2.0.0 (K2 default) | Rely on wider smart casts (local `val` holding a type check, `||` checks, properties with function types); Compose compiler plugin `org.jetbrains.kotlin.plugin.compose` set to the Kotlin version | Projects pinned below 2.0 keep the separate Compose compiler artifact |
| 2.0.20 | Strong skipping on by default (Compose); drop blanket `@Stable`/`remember`-a-lambda workarounds after checking reports | Lists from sources that allocate new equal objects each time (Room) may still want `@Stable` for structural equality |
| 2.1.0 | Exhaustive `when` on a type parameter with a sealed bound needs no `else`; `@SubclassOptInRequired` for library interfaces. Guard conditions, non-local `break`/`continue`, `$$` interpolation are preview here | Without the `-X` flags, keep nested `if` inside branches |
| 2.2.0 | Stable: guard conditions in `when` (`is Cat if !x ->`), non-local `break`/`continue` in inline lambdas, multi-dollar interpolation. Preview: context parameters, context-sensitive resolution; beta: nested type aliases | A guard that hides an exhaustiveness gap; context parameters need the flag on 2.2 and 2.3 |
| 2.3.0 | Stable: nested type aliases, data-flow-based exhaustiveness for `when`, `kotlin.time.Clock`/`Instant`; `return` in expression bodies with explicit types. Experimental: unused return value checker, explicit backing fields, `Uuid` | Projects on `kotlinx-datetime` `Instant` keep it until migrated deliberately |
| 2.4.0 | Stable: context parameters (not context arguments or callable references), explicit backing fields (`val x: StateFlow<T>` with `field = MutableStateFlow(…)`) replacing `_x`/`x` pairs, `@all` use-site target, `kotlin.uuid.Uuid` (V4/V7 generation still experimental), `isSorted*()`. Experimental: collection literals, unused return value checker | Context parameters for ordinary dependencies a constructor can take; libraries whose consumers are on older compilers |
| 2.4.20 | `when` compiled with `invokedynamic` on JVM 21+ (default); `allDistinct()`/`allEqual()` (experimental) | Nothing to rewrite; note only when reviewing bytecode-sensitive code |

Kotlin 2.4.21 (2026-10-08) is the latest release (KWN releases). Do not
suggest experimental features as fixes.

## 6. Concurrency model

- Structured concurrency: coroutines start only in a `CoroutineScope`; a
  parent waits for its children, and a failed or cancelled parent cancels
  them recursively (KCO basics "Coroutine scope and structured
  concurrency", context "Parental responsibilities").
- Failure flows upward in a regular scope (a failing child cancels parent
  and siblings) and only downward under `supervisorScope`/`SupervisorJob`
  (KCO exceptions "Supervision").
- Cancellation is cooperative and travels as `CancellationException`:
  suspension points check it, CPU loops must check it, catch blocks must
  rethrow it, cleanup that suspends needs `NonCancellable`, and a cancelled
  coroutine does not resume with an available value (prompt cancellation)
  (KCO cancellation).
- Dispatchers: `Default` for CPU work (CPU-count threads, at least two),
  `IO` for blocking calls (max(64, cores), elastic, shares threads with
  `Default`), `limitedParallelism(n)` to bound one subsystem, `Main` for UI
  (KXC `Dispatchers.*`, `limitedParallelism`).
- Shared mutable state across dispatcher threads needs an atomic, a
  `Mutex` (suspending, not reentrant), or confinement to one thread; prefer
  coarse-grained confinement over switching per access; `@Volatile` gives
  visibility, not atomic compound updates (KCO shared mutable state, KXC
  `Mutex`).
- Flows are cold and run in the collector's context; `flowOn` changes the
  upstream only; `channelFlow` for concurrent producers; hot flows
  (`StateFlow`, `SharedFlow`, `stateIn`, `shareIn`) run until their sharing
  scope ends (KCO Flows, KXC `Flow`).
- Correctness vs speed: if dropping the finding gives a wrong result, a
  leak or a hang, it is 4.3; if it only makes the program slower, it is 4.4.
- Patterns (parallel decomposition, event `SharedFlow`, Turbine tests):
  `kotlin-coroutines-flows`.

## 7. Linter mapping

Run the project's own checks first (`lefthook.yml`,
`.pre-commit-config.yaml`, CI results via `gh pr checks`) and pass their
output to the review; never report "no issues" from a tool that did not run.
Without project hooks, the standalone `ktlint` CLI and the detekt CLI
(`detekt --input <changed files>`, no type resolution) read sources without
executing project code; detekt's type-resolution rules, Android Lint
(`./gradlew lint`) and compiler warnings need Gradle, which executes the
diff's build scripts: name those commands for a human, or read CI output.
Do not restate what a tool that ran already reported.

| Item | Caught by |
|---|---|
| kt-not-null-assert | detekt `UnsafeCallOnNullableType`, `MapGetWithNotNullAssertionOperator` |
| kt-platform-type | detekt `HasPlatformType` |
| kt-lateinit | detekt `LateinitUsage` (off by default) |
| kt-exhaustive-when | detekt `ElseCaseInsteadOfExhaustiveWhen` (off by default) |
| kt-referential-eq | detekt `AvoidReferentialEquality` |
| kt-double-mutability | detekt `DoubleMutabilityForCollection` |
| kt-ignored-result | detekt `IgnoredReturnValue`; compiler unused return value checker (2.3+, experimental) |
| kt-swallow-cancel | detekt `SuspendFunSwallowedCancellation` (off by default), `TooGenericExceptionCaught` |
| kt-generic-catch, kt-swallowed | detekt `TooGenericExceptionCaught`, `SwallowedException`, `PrintStackTrace` |
| kt-preconditions | detekt `UseRequire`, `UseCheckOrError`, `UseRequireNotNull`, `UseCheckNotNull` |
| kt-finally-suspend | detekt `SuspendFunInFinallySection` (off by default) |
| kt-global-scope | detekt `GlobalCoroutineUsage` (off by default); opt-in requirement `DelicateCoroutinesApi` (compiler) |
| kt-inject-dispatcher | detekt `InjectDispatcher` |
| kt-blocking-in-suspend (`Thread.sleep`) | detekt `SleepInsteadOfDelay` |
| kt-flow-return | detekt `SuspendFunWithFlowReturnType` |
| kt-scope-receiver | detekt `SuspendFunWithCoroutineScopeReceiver` (off by default) |
| kt-redundant-suspend | detekt `RedundantSuspendModifier` |
| kt-boxing (arrays) | detekt `ArrayPrimitive` |
| kt-sequence-fit | detekt `CouldBeSequence` (off by default) |
| kt-collection-shortcut | detekt `UnnecessaryFilter`, `UseAnyOrNoneInsteadOfFind`, `RedundantHigherOrderMapUsage` |
| kt-compose-autobox | Android Lint `AutoboxingStateCreation`, `AutoboxingStateValueProperty` |
| kt-compose-derived | Android Lint `FrequentlyChangedStateReadInComposition` |
| kt-compose-collect | Android Lint `StateFlowValueCalledInComposition` |
| kt-ui-collect | Android Lint `RepeatOnLifecycleWrongUsage`, `UnsafeRepeatOnLifecycleDetector` |
| kt-compose-side-effect | Android Lint `CoroutineCreationDuringComposition`, `FlowOperatorInvokedInComposition`, `ProduceStateDoesNotAssignValue` |
| kt-compose-mutable-state | Android Lint `MutableCollectionMutableState`, `UnrememberedMutableState` |
| kt-modifier-param | Android Lint `ModifierParameter`, `ComposeModifierMissing` |
| kt-vm-context | Android Lint `StaticFieldLeak` |
| kt-test-runtest | detekt `CoroutineLaunchedInTestWithoutRunTest` (off by default) |
| kt-const-naming, kt-backing-property | ktlint `property-naming`, `backing-property-naming` |
| kt-wildcard-import | ktlint `no-wildcard-imports`, detekt `WildcardImport` |
| kt-file-name | ktlint `filename` |
| hard-coded UI strings | Android Lint `HardcodedText` |
| API above `minSdk` | Android Lint `NewApi` |
| security items (kt-security-routing) | Android Lint `ExportedService`, `ExportedReceiver`, `ExportedContentProvider`, `SetJavaScriptEnabled`, `AddJavascriptInterface`, `DefaultCleartextTraffic` |
| all compiler warnings | `allWarningsAsErrors` in the project's compiler options, when set |

No linter decides: scope ownership, dispatcher fit for a given call, whether
a loop is hot, whether a sequence pays off at the real size, whether strong
skipping makes a stability finding moot, whether siblings need supervision,
or whether a version gate applies. Those are the review's work.
