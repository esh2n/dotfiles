# Java review standard

The one Java (and Spring Boot) standard for both the model writing Java and
`code-reviewer` reviewing a Java diff. It lists what to check and where the
rule comes from; detail and code live in the skills it links:
`java-coding-standards` (naming, immutability, Optional, exceptions, layout),
`java-testing` (JUnit, AssertJ, Mockito, Testcontainers), `springboot-patterns`
(controllers, services, caching, async, filters), `springboot-tdd` (test slices,
MockMvc), `springboot-verification` (build, static analysis and coverage loop).
SQL text, plans and indexes belong to `sql-tuning/references/review-standard.md`;
injection, auth and secrets findings belong to `security-reviewer`.

Before applying any rule, read the release level (`maven.compiler.release`,
Gradle `toolchain`/`sourceCompatibility`), the runtime JDK in the Dockerfile or
run configuration, and the Spring Boot, Spring Framework and Hibernate versions
from `pom.xml`/`build.gradle(.kts)`. A rule gated on a version does not apply
below it. Confirm an API exists at that release before suggesting it; never
from memory. Do not run Maven or Gradle against the diff (they compile and run
plugin code); read CI output instead.

Sources are cited by the short name in the first column of section 1; a `#`
suffix names the section or anchor on that page.

## 1. Sources

| Short | Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|---|
| GJS | Google Java Style Guide | https://google.github.io/styleguide/javaguide.html | Naming, imports (incl. module imports), switch exhaustiveness, `@Override`, caught exceptions, finalizers | Undated; uses `_` unnamed variables and `list.getFirst()`, so post-JDK 21; fetched 2026-10-19 | CC BY 3.0 (google/styleguide) |
| JLS17 | Java Language Specification SE 25, chapter 17 | https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html | Happens-before (§17.4.5), synchronization order (§17.4.4), final fields (§17.5), word tearing (§17.6), non-atomic `long`/`double` (§17.7) | SE 25 edition | Oracle specification licence |
| JDK | OpenJDK release project pages JDK 16, 17, 21–27 | https://openjdk.org/projects/jdk/21/ (replace the number) | JEP list and preview/final status per release | JDK 27 GA 2026-09-15 (latest); JDK 25 GA 2025-09-16 (LTS); JDK 21 GA 2023-09-19 (LTS) | OpenJDK site terms |
| J444 | JEP 444 Virtual Threads | https://openjdk.org/jeps/444 | Per-task virtual threads, no pooling, semaphores, thread-local cost | JDK 21, final | OpenJDK site terms |
| J491 | JEP 491 Synchronize Virtual Threads without Pinning | https://openjdk.org/jeps/491 | `synchronized` no longer pins; remaining pin cases; `jdk.tracePinnedThreads` removed | JDK 24, delivered | OpenJDK site terms |
| J506 | JEP 506 Scoped Values | https://openjdk.org/jeps/506 | Scoped values final; when `ThreadLocal` remains right | JDK 25, final | OpenJDK site terms |
| J533 | JEP 533 Structured Concurrency (Seventh Preview) | https://openjdk.org/jeps/533 | `StructuredTaskScope` API, still preview | JDK 27, preview | OpenJDK site terms |
| VTG | JDK 25 Core Libraries guide: Virtual Threads | https://docs.oracle.com/en/java/javase/25/core/virtual-threads.html | Adoption rules, semaphores, `ThreadLocal` caching, JFR `jdk.VirtualThreadPinned` (20 ms threshold) | JDK 25 | Oracle documentation licence |
| API | Java SE 25 API docs (`Optional`, `ConcurrentHashMap`, `LongAdder`, `SimpleDateFormat`, `Pattern`) | https://docs.oracle.com/en/java/javase/25/docs/api/ | API contracts | JDK 25 | Oracle documentation licence |
| JAVAC | `javac` man page, `-Xlint` keys | https://docs.oracle.com/en/java/javase/25/docs/specs/man/javac.html | `rawtypes`, `unchecked`, `this-escape`, `identity`, `lossy-conversions`, `fallthrough`, `try` | JDK 25 | Oracle documentation licence |
| SFTX | Spring Framework: Using `@Transactional`; Rollback rules | https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html, https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/rolling-back.html | Proxy self-invocation, visibility, class vs interface, `readOnly`, default rollback, `rollbackOn = ALL_EXCEPTIONS` (6.2) | Spring Framework 7.0.9 | Apache-2.0 (docs in spring-framework repo) |
| SFDI | Spring Framework: Dependency Injection; Bean Scopes | https://docs.spring.io/spring-framework/reference/core/beans/dependencies/factory-collaborators.html, https://docs.spring.io/spring-framework/reference/core/beans/factory-scopes.html | Constructor injection advocated; prototype injected into singleton once | 7.0.9 | Apache-2.0 |
| SFC | Spring Framework: Cache annotations | https://docs.spring.io/spring-framework/reference/integration/cache/annotations.html | Proxy mode: self-invocation not cached | 7.0.9 | Apache-2.0 |
| SFMVC | Spring Framework: `@RequestBody` validation; Error Responses | https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-methods/requestbody.html, https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html | `@Valid`/`@Validated`, `ProblemDetail` (RFC 9457) | 7.0.9 | Apache-2.0 |
| SFT | Spring Framework: Test-managed transactions | https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/tx.html | Flush the unit of work to avoid ORM false positives | 7.0.9 | Apache-2.0 |
| SBSQL | Spring Boot: SQL Databases | https://docs.spring.io/spring-boot/reference/data/sql.html | Open EntityManager in View on by default, `spring.jpa.open-in-view` | Spring Boot 4.1.1 | Apache-2.0 |
| SBTASK | Spring Boot: Task Execution and Scheduling | https://docs.spring.io/spring-boot/reference/features/task-execution-and-scheduling.html | Auto-configured executor (8 core threads; queue bounded only when configured), scheduler of one thread, virtual-thread variants | 4.1.1 | Apache-2.0 |
| SBCFG | Spring Boot: Externalized Configuration | https://docs.spring.io/spring-boot/reference/features/external-config.html | `@ConfigurationProperties` vs `@Value`, constructor binding, `@Validated` | 4.1.1 | Apache-2.0 |
| SBTEST | Spring Boot: Testing Spring Boot Applications; 3.4 release notes | https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html, https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.4-Release-Notes | Test slices, `@MockitoBean`; `@MockBean` deprecated in 3.4 | 4.1.1 / 3.4 | Apache-2.0 |
| SDJ | Spring Data JPA: Query Methods | https://docs.spring.io/spring-data/jpa/reference/jpa/query-methods.html | `@Modifying` (needs `@Query`, `clearAutomatically`), `@EntityGraph(attributePaths)` | Current | Apache-2.0 |
| HIB | An Introduction to Hibernate 7 | https://docs.hibernate.org/orm/7.1/introduction/html_single/ | N+1 (§5.6, §8.4), LAZY mapping (§5.6), batch/subselect fetching (§8.5), join fetching (§8.6), JDBC batching (§8.3), large results (§5.13), caches (§8.7–8.12) | 7.1.36.Final | Apache-2.0 |
| HIBID | Hibernate Discourse: batch inserts with IDENTITY | https://discourse.hibernate.org/t/why-cant-hibernate-do-batch-inserts-when-i-using-identity-generators-mysql8/10200 | `IDENTITY` disables insert batching; sequences keep it | 2024-08/09 forum answers | Forum post |
| VM104 | Vlad Mihalcea: HHH000104 pagination warning | https://vladmihalcea.com/fix-hibernate-hhh000104-entity-fetch-pagination-warning-message/ | Collection fetch join + paging runs in memory; two-query and window-function fixes | 2017-09-13 (Hibernate 6 fix added) | Blog, all rights reserved (cited only) |
| EP | Error Prone bug patterns | https://errorprone.info/bugpatterns | Check names and on-by-default level | Undated catalogue; fetched 2026-10-19 | Apache-2.0 |
| SB | SpotBugs bug descriptions | https://spotbugs.readthedocs.io/en/latest/bugDescriptions.html | Bug pattern codes | SpotBugs 4.10.5 | LGPL-2.1 (tool) |
| CS | Checkstyle checks | https://checkstyle.org/checks.html | Check names (incl. `google_checks.xml`) | 14.3.0, published 2026-09-27 | LGPL-2.1 (tool) |
| PMD | PMD Java rules | https://pmd.github.io/pmd/pmd_rules_java.html | Rule names | PMD 7.28.0 (2026-09-25) | BSD-style (tool) |
| SLF4J | SLF4J FAQ | https://www.slf4j.org/faq.html | Parameterized logging, cost of disabled logging | Current | MIT |
| AWAIT | Awaitility | https://github.com/awaitility/awaitility | Asserting on asynchronous results without sleeps | Current | Apache-2.0 |

Effective Java (3rd ed., Joshua Bloch, 2018) may be named, never quoted; it
predates records, sealed classes, pattern matching and virtual threads, so its
advice on those areas (builders for value types, `instanceof` chains, thread
pools) needs the JDK sources above before it is cited. JUnit is at 6.1.3
(https://docs.junit.org/current/user-guide/).

## 2. Mindset

- Types carry the design: records for data carriers, sealed hierarchies plus
  exhaustive `switch` for closed sets, so a missing case fails to compile (JDK
  16/17/21, GJS#s4.8.4.3).
- Immutable by default; `final` fields give safe publication for free
  (JLS17 §17.5).
- `Optional` is a return type, not a field or parameter (API `Optional`).
- An exception is handled, rethrown with its cause, or documented as ignored —
  never dropped (GJS#s6.2).
- Shared mutable state needs a happens-before edge; "it works in tests" is not
  one (JLS17 §17.4.5).
- Virtual threads give scale for blocking I/O, not speed; tasks become threads,
  pools of virtual threads do not exist (VTG).
- Spring behaviour comes from proxies: an annotation only works on a call that
  crosses the proxy (SFTX, SFC).
- Fetch what a unit of work needs up front; lazy loading in a loop is N+1
  (HIB §5.6).
- Performance claims name a frequency and a cost; the JIT removes much of
  what looks expensive, so appearance alone is not evidence.

## 3. Habits carried from other languages

| Habit | Do instead | Source |
|---|---|---|
| `null` or `-1` meaning "not found" (C, older Java) | Return `Optional<T>` from finders; empty collection, not `null`, for lists | API `Optional`, PMD `ReturnEmptyCollectionRatherThanNull` |
| `Optional`/`Maybe` used as a field or parameter type (Scala, Kotlin ports) | Plain nullable field or overload; `Optional` only as a return type | API `Optional` ("primarily intended for use as a method return type") |
| `==` to compare strings or boxed numbers (JS, C#) | `equals`, `Objects.equals`, `compareTo` for `BigDecimal` | EP `ReferenceEquality`, `BoxedPrimitiveEquality`, `BigDecimalEquals`; PMD `UseEqualsToCompareStrings` |
| Empty `catch` to silence a checked exception (Go `_ =`, Python `except: pass`) | Handle, wrap with cause, or comment why ignoring is correct | GJS#s6.2-caught-exceptions |
| Thread pool sized to absorb blocking I/O (pre-21 Java, C#) | Virtual thread per task; `Semaphore` to cap a resource | J444, VTG |
| `ThreadLocal` as a per-thread object cache (pre-21 Java) | Share an immutable, thread-safe object (`DateTimeFormatter`); scoped values for one-way context | VTG, J506 |
| Wildcard and module imports (`import x.*`, `import module java.base`) | Single-type imports | GJS#s3.3.1-wildcard-imports, GJS#s3.3.1.1-module-imports |
| `URL`/`HTTP` all-caps inside camel case (Go, C#) | `XmlHttpRequest`, `customerId` per the camel-case algorithm | GJS#s5.3-camel-case |
| Field injection via `@Autowired` (older Spring tutorials) | Constructor injection, `final` fields | SFDI |

## 4. Review items

Format: `id` — trigger visible in a diff — what to check — why — source.
One-line items are general knowledge; detail appears only where judgment or a
threshold is involved.

### 4.1 Correctness and types

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| java-optional-get | `optional.get()` / `orElse(null)` without a prior check | `orElseThrow(...)`, `map`, `ifPresentOrElse` | `get()` on empty throws `NoSuchElementException` | API `Optional`, EP `OptionalNotPresent` |
| java-optional-misuse | `Optional` as field, parameter, or collection element | Return type only | Adds a third state (null `Optional`) | API `Optional` |
| java-equals-hashcode | `equals` overridden without `hashCode` (or the reverse) | Both, consistent; records generate both | Hash collections lose entries | EP `EqualsHashCode`, SB `HE_EQUALS_USE_HASHCODE` |
| java-reference-equality | `==`/`!=` on `String`, `Integer`, `Long`, `BigDecimal` | `equals`; `compareTo` for `BigDecimal` scale-insensitive equality | Identity comparison; boxed cache hides the bug for small values | EP `ReferenceEquality`, `BoxedPrimitiveEquality`, `BigDecimalEquals`; PMD `CompareObjectsWithEquals` |
| java-bigdecimal-double | `new BigDecimal(0.1)` | `BigDecimal.valueOf` or a string literal | Binary rounding error carried in | EP `BigDecimalLiteralDouble` |
| java-raw-types | `List`, `Map` without type arguments; `@SuppressWarnings("unchecked")` added | Parameterize; suppression on the smallest scope with a reason | Heap pollution and `ClassCastException` at a distance | JAVAC `rawtypes`, `unchecked` |
| java-ignored-return | Result of `String.trim()`, `replace`, `BigDecimal.add`, `Stream.map`, `File.delete` discarded | Assign or check it | Immutable APIs return the result; the call does nothing | EP `ReturnValueIgnored`, `CheckReturnValue`; SB `RV_RETURN_VALUE_IGNORED` |
| java-switch-exhaustive | `switch` over enum/sealed type without all cases; `default` hiding new cases | Exhaustive switch; on sealed types prefer no `default` so a new subtype fails to compile; old-style fall-through commented | Silent miss when a case is added | GJS#s4.8.4.3, GJS#s4.8.4.2, EP `MissingCasesInEnumSwitch`, JAVAC `fallthrough` |
| java-expose-rep | Getter returns, or constructor stores, a caller's mutable collection/array/`Date` | `List.copyOf` on the way in or out; unmodifiable view | Callers mutate internal state | SB `EI_EXPOSE_REP`, `EI_EXPOSE_REP2`; EP `MixedMutabilityReturnType` |
| java-this-escape | Constructor passes `this` to a listener, executor, overridable method | Finish construction first; factory method | Others see a half-built object; `final` field guarantee is lost | JAVAC `this-escape`, JLS17 §17.5 |
| java-resource-close | `InputStream`, `Connection`, `ResultSet`, `Stream` from `Files.lines` opened without try-with-resources | try-with-resources on every path | Leaks descriptors and pooled connections | SB `OBL_UNSATISFIED_OBLIGATION`, `OS_OPEN_STREAM`, `ODR_OPEN_DATABASE_RESOURCE`; EP `StreamResourceLeak`, `MustBeClosedChecker`; PMD `CloseResource` |
| java-modify-while-iterating | `list.remove` inside enhanced `for` over the same list | `removeIf` or an explicit iterator | `ConcurrentModificationException` | EP `ModifyCollectionInEnhancedForLoop` |
| java-lossy-compound | `int x += long` / `short s *= …` | Explicit cast with a reason, or widen the variable | Silent narrowing | EP `NarrowingCompoundAssignment`, JAVAC `lossy-conversions` |
| java-default-locale-charset | `getBytes()`, `new String(bytes)`, `FileReader`, `toLowerCase()` without charset/locale; `LocalDate.now()` without `Clock`/zone | Pass `StandardCharsets.UTF_8`, `Locale.ROOT`, a `Clock` | Output depends on the host | EP `DefaultCharset`, `JavaTimeDefaultTimeZone`; SB `DM_DEFAULT_ENCODING`; PMD `UseLocaleWithCaseConversions` |
| java-finalize | `finalize()` override | `Cleaner` or try-with-resources | Finalization is scheduled for removal | GJS#s6.4-finalizers |
| java-security-handoff | SQL/JPQL built by string concatenation, `Runtime.exec`/`ProcessBuilder` with input, file paths from input, secrets in source | Report to `security-reviewer` with file:line; bind parameters (`?`, `:name`) | Injection | SB `SQL_NONCONSTANT_STRING_PASSED_TO_EXECUTE`, `SQL_PREPARED_STATEMENT_GENERATED_FROM_NONCONSTANT_STRING` |

### 4.2 Exceptions

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| java-empty-catch | Empty `catch` block | Act, rethrow, or comment why nothing is right (name the variable `_` on 22+) | Lost failures | GJS#s6.2-caught-exceptions, EP `EmptyCatch`, PMD `EmptyCatchBlock` |
| java-catch-broad | `catch (Exception e)` / `Throwable` outside a top-level handler | Catch the specific types; broad catch only at a boundary that logs and maps | Swallows `RuntimeException` bugs and interrupts | PMD `AvoidCatchingGenericException`, SB `REC_CATCH_EXCEPTION` |
| java-lost-cause | `throw new XException(e.getMessage())` | Pass `e` as the cause | Stack trace lost | PMD `PreserveStackTrace` |
| java-print-stack-trace | `e.printStackTrace()`, `System.out` in `src/main` | Logger with the exception as last argument | Bypasses log routing and levels | EP `CatchAndPrintStackTrace`, PMD `AvoidPrintStackTrace` |
| java-interrupt | `catch (InterruptedException e)` that neither rethrows nor calls `Thread.currentThread().interrupt()` | Restore the flag or propagate | Cancellation is lost; executors and virtual threads cannot stop the task | EP `InterruptedExceptionSwallowed` (experimental) |
| java-raw-exception | `throw new RuntimeException(...)` / `Exception` | Domain-specific or standard specific type (`IllegalArgumentException`, `IllegalStateException`) | Callers cannot distinguish failures | PMD `AvoidThrowingRawExceptionTypes` |
| java-future-ignored | `executor.submit(...)` or a `CompletableFuture` result discarded | Keep and join it, or handle failure in the chain | Exceptions inside vanish | EP `FutureReturnValueIgnored` |
| java-error-mapping | Exception handling repeated per controller, `e.getMessage()` in a response body | One `@RestControllerAdvice`; `ProblemDetail` (RFC 9457) via `ResponseEntityExceptionHandler` or `spring.mvc.problemdetails.enabled`; log detail server-side | Consistent status codes; no internals leaked | SFMVC (Error Responses) |

### 4.3 Concurrency

A finding needs a concrete interleaving or a hang, not "might race". Model in
section 6.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| java-shared-mutable | Non-final field written after construction in a singleton bean, servlet, or object shared across threads | Make it immutable, confine it, or guard every access with the same lock/atomic | Data race; Spring beans are singletons by default | JLS17 §17.4.5, SFDI (Bean Scopes), SB `IS2_INCONSISTENT_SYNC`, EP `GuardedBy` |
| java-dcl | `if (x == null) { synchronized … if (x == null) x = …}` on a non-`volatile` field | `volatile`, holder class idiom, or eager init | Other threads may see a partly constructed object | EP `DoubleCheckedLocking`, SB `DC_DOUBLECHECK`, PMD `DoubleCheckedLocking` |
| java-volatile-rmw | `volatileField++`, check-then-act on a `volatile` or concurrent map (`if (!map.containsKey(k)) map.put(…)`) | `AtomicLong`/`LongAdder`, `putIfAbsent`/`computeIfAbsent` | `volatile` gives visibility, not atomicity | SB `VO_VOLATILE_INCREMENT`, `AT_NONATOMIC_OPERATIONS_ON_SHARED_VARIABLE` |
| java-long-tearing | Shared non-volatile `long`/`double` written and read without a lock | `volatile` or an atomic | Writes may be split into two 32-bit halves | JLS17 §17.7 |
| java-chm-compute | `computeIfAbsent`/`compute` mapping function that is slow, does I/O, or touches the same map | Short, side-effect-free function; load outside, then `putIfAbsent` | The bin stays locked; updating other mappings is forbidden | API `ConcurrentHashMap` |
| java-sync-target | `synchronized` on a non-final field, a boxed value, a `String` literal, or a value-based class | Private final lock object | Lock identity changes or is shared with unrelated code | EP `SynchronizeOnNonFinalField`, JAVAC `identity` |
| java-lock-try | `lock.lock()` not immediately followed by `try { … } finally { unlock(); }` | Move `lock()` directly before `try` | Exception between them leaves the lock held | EP `LockNotBeforeTry` |
| java-wait-loop | `wait()` not inside a `while` re-checking the condition | Loop on the condition | Spurious wakeups | EP `WaitNotInLoop` |
| java-shared-formatter | `static SimpleDateFormat`/`DecimalFormat` used from several threads | `DateTimeFormatter` (immutable) | Not synchronized; corrupt output | API `SimpleDateFormat`, SB `STCAL_STATIC_SIMPLE_DATE_FORMAT_INSTANCE` |
| java-vt-pinning | `synchronized` around blocking I/O on a virtual-thread path | Read the runtime JDK first. Below 24: real, use `ReentrantLock` or move the blocking call out. At 24+: not a finding (do not ask to rewrite working `synchronized`). Any JDK: native frames, blocking in a class initializer, or waiting for another thread's class initialization still pin | JEP 491 inverted the old rule | J491, VTG |
| java-vt-pool | `Executors.newFixedThreadPool(n, Thread.ofVirtual().factory())`, a pool of virtual threads, or a platform pool kept only to cap concurrency | `newVirtualThreadPerTaskExecutor()` in try-with-resources; `Semaphore` around the limited resource (a connection pool already is one) | Pools share scarce resources; virtual threads are not scarce | J444, VTG |
| java-vt-cpu | CPU-bound work moved onto virtual threads | Keep a platform pool sized to cores | Virtual threads add scale for blocking, not compute throughput | J444, VTG |
| java-threadlocal | New `ThreadLocal`, especially caching an expensive object, on a virtual-thread path; `ThreadLocal` in a pooled thread without `remove()` | Shared thread-safe object; scoped values (25+) for one-way immutable context; `remove()` in `finally` on pools. Two-way or mutable use stays `ThreadLocal` | One copy per virtual thread multiplies memory; pooled threads leak values across requests | VTG, J444, J506, EP `ThreadLocalUsage` |
| java-unbounded-submit | `submit` per element of a data-sized collection, `newCachedThreadPool`, unbounded `LinkedBlockingQueue` | Bound by `Semaphore` or a bounded queue with a rejection policy | Thread or memory exhaustion under load (severity: critical) | VTG (semaphores), SBTASK (queue is bounded only when `queue-capacity` is set) |
| java-structured-preview | `StructuredTaskScope` in production code | Allowed only with `--enable-preview` accepted by the project; API changed again in 27 | Preview API, still changing | J533 |

### 4.4 Performance

Report only on paths that run often (request path, per-row loop, batch job);
cold or startup code is out of scope. Tag each finding `static` (holds without
measurement: a lazy association dereferenced in a loop, `+=` on a `String` in a
loop) or `needs-measurement`, and name the command that would confirm it (JMH
with `-prof gc`, a JFR recording with `jfr print --events
ObjectAllocationSample,JavaMonitorEnter`, async-profiler `-e alloc|lock`, or
SQL logging counting queries per request). Never call a claim verified without
a warmed baseline, a profile showing the blamed frame, and a re-measurement
whose mechanism matches. Do not report streams, lambdas or `Optional` on an
ordinary request path, getter overhead, or object pooling without a profile.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| java-n-plus-one | Loop over entities dereferencing a lazy `@ManyToOne`/`@OneToMany` | Fetch up front: `join fetch` in JPQL/HQL or `@EntityGraph(attributePaths = …)`. `@BatchSize`/`hibernate.default_batch_fetch_size` mitigates, does not solve; use it when a join would give a cartesian product | One query per row; "the most common cause of poorly-performing data access code" | HIB §5.6, §8.4, §8.5, §8.6; SDJ |
| java-eager-mapping | `fetch = FetchType.EAGER` added; `@ManyToOne`/`@OneToOne` without `fetch = LAZY` | Map LAZY; request eager fetching per query | Every query pays for the association (`@ManyToOne` is eager by default) | HIB §5.6 |
| java-cartesian-fetch | Two collection `join fetch`es in one query | Subselect fetching or separate queries | Row count multiplies | HIB §8.6 |
| java-fetch-pagination | `join fetch` of a collection with `setMaxResults`/`Pageable` | Page ids first, then fetch by ids; or a window-function query | Hibernate drops `LIMIT` and paginates in memory (HHH000104) | VM104 |
| java-jdbc-batch | `save`/`persist` per entity in a loop | `hibernate.jdbc.batch_size` (plus ordered inserts/updates); with `GenerationType.IDENTITY` insert batching is disabled, so the property alone does nothing (sequence generator restores it); for mass update/delete use one HQL `update`/`delete` | Round trips per row | HIB §8.3, HIBID |
| java-large-result | `findAll()` on a growing table, list endpoint without `Pageable`, stream of a whole table collected to a list | Paginate; `StatelessSession` or chunked processing for batch work | Unbounded memory and session cache (severity: critical when unbounded) | HIB §5.13, §8.2 |
| java-open-in-view | `spring.jpa.open-in-view` unset in a web app | Set `false`; fix the lazy loads the change exposes | On by default; hides N+1 in rendering and holds the connection for the whole request | SBSQL |
| java-modifying-stale | `@Modifying` bulk query followed by reads of the same entities | `clearAutomatically = true` or reload | The persistence context keeps outdated entities | SDJ |
| java-query-cache | `hibernate.cache.use_query_cache` or second-level cache enabled on write-heavy data | Justify with hit rate; data changed outside Hibernate makes it stale | Query cache is "only rarely" efficient and can break ACID | HIB §8.7, §8.12 |
| java-string-concat-loop | `s += …` on a `String` inside a loop | One `StringBuilder` outside the loop, `String.join`, `Collectors.joining`; single-expression concatenation is fine | Quadratic copying | SB `SBSC_USE_STRINGBUFFER_CONCATENATION`, PMD `UseStringBufferForStringAppends` |
| java-pattern-hoist | `Pattern.compile`, `String.matches`/`replaceAll`/`split(regex)` inside a hot method | `static final Pattern` | Recompiled per call; `Pattern` is immutable and thread-safe | API `Pattern` |
| java-boxing-hot | `Map<Integer, Long>`, `List<Integer>`, `Long` accumulator on a per-element path; `new Integer(..)`, `Integer.valueOf(s).intValue()` | Primitive arrays/streams, `parseInt`; needs-measurement unless the loop count is known | Allocation per element | SB `DM_BOXED_PRIMITIVE_FOR_PARSING`, `DM_NUMBER_CTOR`; EP `BoxedPrimitiveConstructor` |
| java-objects-in-loop | `ObjectMapper`, `DateTimeFormatter`, `Pattern`, `MessageDigest` built per call on a hot path | Hoist thread-safe ones to a field; needs-measurement for the rest | Costly construction repeated | PMD `AvoidInstantiatingObjectsInLoops` |
| java-legacy-sync-collections | `Vector`, `Hashtable`, `StringBuffer`, `Collections.synchronizedMap` on a hot path | `ArrayList`, `ConcurrentHashMap`, `StringBuilder` | One monitor per instance | EP `JdkObsolete` |
| java-contended-counter | `synchronized` or `AtomicLong` counter updated by many threads | `LongAdder` for write-heavy statistics; needs-measurement | Higher throughput under contention, more space | API `LongAdder` |
| java-log-eager | `log.debug("x=" + expensive())` | Placeholders `{}`; guard or supplier for costly arguments | Message built even when the level is off | SLF4J (FAQ "fastest way of (not) logging") |
| java-runtime-moot | Allocation-footprint or GC-pause finding | Check the runtime: compact object headers are a product flag in 25 and default in 27; G1 is the default collector in all environments from 27; collector choice comes before a code rewrite | A runtime change may answer it | JDK (25: JEP 519; 27: JEPs 534, 523) |

### 4.5 API design

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| java-record-carrier | New class with only final fields, constructor, accessors, `equals`/`hashCode`/`toString` on release 16+ | `record`; validate in the compact constructor | Removes boilerplate and inconsistent equality | JDK 16 (JEP 395) |
| java-sealed-closed-set | Closed hierarchy modelled with an open interface plus `instanceof` chain, on 17+ | `sealed … permits` and an exhaustive pattern `switch` (21+) | Compiler checks completeness | JDK 17 (JEP 409), JDK 21 (JEPs 440, 441) |
| java-null-collections | Method returning `null` for "no items" | Empty collection | Every caller needs a null check | PMD `ReturnEmptyCollectionRatherThanNull` |
| java-immutable-fields | Field assigned only in the constructor but not `final`; public mutable fields | `final`; private | Safe publication; encapsulation | JLS17 §17.5, PMD `ImmutableField`, CS `VisibilityModifier` |
| java-mutable-static | Non-final `static` field, or `static final` mutable collection treated as a constant | Instance state injected; truly immutable constants only | Hidden global state; a constant must be deeply immutable | PMD `MutableStaticState`, GJS#s5.2.4-constant-names |
| java-long-params | Many positional parameters or boolean flags; constructor with many injected dependencies | Parameter object or record; split the class | Unreadable call sites; too many responsibilities | PMD `ExcessiveParameterList`, CS `ParameterNumber`, SFDI |
| java-override | Overriding or implementing method without `@Override` | Add it (also on explicit record accessors) | Signature drift compiles silently | GJS#s6.1-override-annotation, EP `MissingOverride` |
| java-utility-class | Class of only static methods with a public constructor | Private constructor, `final` | Prevents meaningless instances | PMD `UseUtilityClass` |

### 4.6 Spring-specific

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| spring-tx-self-invocation | `@Transactional` (or `@Cacheable`, `@Async`) method called from another method of the same bean; called from `@PostConstruct` | Move to another bean, or call through the proxy; AspectJ mode if self-calls must be wrapped | Proxy mode intercepts only external calls; the annotation silently does nothing | SFTX, SFC |
| spring-tx-placement | `@Transactional` on an interface method, or on a method of a JDK interface-based proxy that is not `public` | Annotate concrete class methods; interface proxies need `public` interface methods (class proxies accept protected/package since 6.0) | Annotations can be silently ignored "until you test a rollback scenario" | SFTX |
| spring-tx-checked-rollback | `@Transactional` method throwing a checked exception expected to roll back | `rollbackFor`, or `@EnableTransactionManagement(rollbackOn = ALL_EXCEPTIONS)` (6.2+) | Default rolls back only on `RuntimeException`/`Error`; checked exceptions commit | SFTX (Rollback rules) |
| spring-tx-readonly | `readOnly = true` relied on to prevent writes, or set with propagation other than `REQUIRED`/`REQUIRES_NEW` | Treat it as a hint whose enforcement depends on the transaction manager and driver | Only applicable to those propagations; not a guard | SFTX |
| spring-modifying | `@Query` that updates/deletes without `@Modifying` | `@Modifying` with `@Query`, inside a transaction | Executed as a select otherwise | SDJ |
| spring-field-injection | `@Autowired`/`@Inject` on a field | Constructor injection, `final` field; setter only for optional dependencies | Immutable, non-null, fully initialized components | SFDI |
| spring-prototype-in-singleton | Prototype or request-scoped bean injected into a singleton | `ObjectProvider<T>`, method injection, or scoped proxy | Injected once; the singleton keeps one instance forever | SFDI (Bean Scopes) |
| spring-async-executor | `@Async`/`@EnableAsync` added with no executor configuration on platform threads | Set `spring.task.execution.pool.queue-capacity` and `max-size`, or a custom executor; or virtual threads | Auto-configured pool has 8 core threads and grows only past a bounded queue; without `queue-capacity` work queues without limit | SBTASK |
| spring-scheduled-blocking | Long or blocking `@Scheduled` method | Raise `spring.task.scheduling.pool.size`, hand off to an executor, or enable virtual threads | Default scheduler has one thread; one slow job delays all others | SBTASK |
| spring-virtual-threads | `spring.threads.virtual.enabled=true` added | Runtime JDK 21+ (24+ if blocking code uses `synchronized`, see java-vt-pinning); pooling properties are then ignored; DB pool still bounds concurrency | Executors and schedulers switch to virtual-thread variants | SBTASK, J491 |
| spring-config-props | Several related `@Value("${…}")` fields, or config values unchecked at startup | `@ConfigurationProperties` record with constructor binding and `@Validated` constraints | Typed, validated at startup, relaxed binding | SBCFG |
| spring-validation | `@RequestBody` DTO without `@Valid`/`@Validated`; constraints on the DTO but not triggered | Annotate the parameter; map `MethodArgumentNotValidException` centrally | Bean Validation runs only when requested | SFMVC |

### 4.7 Naming and readability

One line each; Checkstyle with `google_checks.xml` catches most.

| id | Trigger | Check | Source |
|---|---|---|---|
| java-names | `snake_case` methods, lowercase classes, `m_` prefixes | Classes `UpperCamelCase`, methods/fields/locals `lowerCamelCase`, packages lowercase without underscores | GJS#s5.2.1-package-names … GJS#s5.2.7-local-variable-names, CS `TypeName`, `MethodName`, `MemberName`, `PackageName` |
| java-constant-name | `UPPER_SNAKE` on a mutable `static final`, or a deeply immutable constant in camel case | Constant naming only for deeply immutable `static final` | GJS#s5.2.4-constant-names, CS `ConstantName` |
| java-acronyms | `XMLHTTPRequest`, `customerID` | `XmlHttpRequest`, `customerId` | GJS#s5.3-camel-case, CS `AbbreviationAsWordInName` |
| java-unnamed-var | Unused lambda parameter, catch variable or pattern binding named `ignored`/`e` (release 22+) | `_` | GJS#s5.2.9-unnamed-variables, JDK 22 (JEP 456) |
| java-imports | Wildcard or module import | Single-type imports | GJS#s3.3.1-wildcard-imports, GJS#s3.3.1.1-module-imports, CS `AvoidStarImport` |
| java-one-top-level | Several top-level types in one file | One per file | GJS#s3.4.1-one-top-level-class, CS `OneTopLevelClass` |
| java-one-var-per-decl | `int a, b;` | One variable per declaration | GJS#s4.8.2.1-variables-per-declaration, CS `MultipleVariableDeclarations` |
| java-static-via-instance | `instance.staticMethod()` | `ClassName.staticMethod()` | GJS#s6.3-static-members, JAVAC `static` |
| java-complexity | Method that grew past the project's complexity threshold | Extract; follow the project's configured limit, do not invent one | PMD `CognitiveComplexity`, CS `CyclomaticComplexity`, `NPathComplexity` |

### 4.8 Testing

Patterns: `java-testing`, `springboot-tdd`. `test-reviewer` owns whether tests
protect behaviour; these are Java/Spring-specific forms.

| id | Trigger | Check | Source |
|---|---|---|---|
| java-test-slice | `@SpringBootTest` for a controller-only or repository-only test | `@WebMvcTest` (with `@MockitoBean` collaborators) or `@DataJpaTest`; full context for integration | SBTEST |
| java-test-mockbean | New `@MockBean`/`@SpyBean` | `@MockitoBean`/`@MockitoSpyBean` (deprecated since Boot 3.4; not on `@Configuration` classes) | SBTEST (3.4 release notes) |
| java-test-sleep | `Thread.sleep` waiting for async work | Awaitility `await().atMost(...).until(...)` or explicit synchronization | AWAIT |
| java-test-orm-flush | Transactional test asserting ORM writes without `flush()` | Flush the unit of work before asserting | SFT ("Avoid false positives when testing ORM code") |
| java-test-no-assert | Test method with no assertion or `verify` | Assert the behaviour | PMD `UnitTestShouldIncludeAssert` |
| java-test-junit4 | JUnit 4 `@Test` in a method not run, or JUnit 4 mixed into a Jupiter module | Use Jupiter (JUnit 6 current) consistently | EP `JUnit4TestNotRun` |

## 5. Version-gated modern features

Suggest only when the release level is at or above the version; a preview
feature only if the project already enables `--enable-preview`.

| Version | Suggest (final) | Old form still right when |
|---|---|---|
| 16 / 17 (LTS) | Records (16, JEP 395); pattern matching for `instanceof` (16, JEP 394); sealed classes (17, JEP 409); switch expressions and text blocks (available at a 17 floor; their release JEPs were not opened in this run) | A JPA entity (needs a no-arg constructor and mutable state; keep a class); a record exposing a mutable component without a copy |
| 21 (LTS) | Virtual threads (444); pattern matching for `switch` (441); record patterns (440); sequenced collections `getFirst`/`getLast`/`reversed` (431); generational ZGC (439) | CPU-bound pools; a `switch` over an open type where `default` is required; libraries targeting 17 |
| 22–24 | Unnamed variables `_` (22, JEP 456); FFM API (22, JEP 454); Markdown doc comments (23, JEP 467); stream gatherers (24, JEP 485); class-file API (24, JEP 484); `synchronized` without pinning (24, JEP 491) | Non-LTS runtimes in production unless the project tracks every release; keep `ReentrantLock` code that already works (no need to revert) |
| 25 (LTS) | Scoped values (506); flexible constructor bodies (513); module import declarations (511, but GJS forbids them); compact source files (512, scripts only); compact object headers as a product flag (519) | `ThreadLocal` for two-way or mutable per-thread state; style guide bans module imports |
| 26 | JEP 500 "Prepare to Make Final Mean Final" (review code that mutates `final` fields by reflection); HTTP/3 for the HTTP Client API (517) | — |
| 27 | G1 default in all environments (523); compact object headers by default (534) | Workloads tuned for another collector keep explicit flags |

Still preview in 27 — do not suggest without `--enable-preview`: structured
concurrency (533, seventh preview), primitive types in patterns (532), lazy
constants (531); the Vector API is incubating (537) — JDK (27 page). String
templates were previewed in 21–22 and are not in later releases; never suggest
them.

## 6. Concurrency model

- Two accesses to one variable from different threads, at least one a write,
  not ordered by happens-before, is a data race (JLS17 §17.4.5). A correctly
  synchronized program behaves sequentially consistently; a racy one does not
  have to.
- Edges come from: program order in one thread, monitor unlock → later lock of
  the same monitor, `volatile` write → later read, `Thread.start()` → actions
  in the started thread, thread actions → successful `join()` (JLS17 §17.4.4,
  §17.4.5), and the `java.util.concurrent` classes whose docs state memory
  consistency effects.
- `final` fields set in a constructor that does not leak `this` are seen
  correctly by any thread that obtains the reference afterwards; non-final
  fields have no such guarantee (JLS17 §17.5).
- Non-volatile `long`/`double` writes may tear; reference writes never do
  (JLS17 §17.7).
- `volatile` gives visibility and ordering, not atomic read-modify-write; use
  atomics or locks for compound actions.
- Virtual threads (21+): one per task, never pooled; cap a resource with a
  `Semaphore`; they add throughput for blocking I/O, not speed for compute
  (J444, VTG). On 24+ `synchronized` does not pin; native frames and class
  initialization still do. Find remaining pinning with the JFR event
  `jdk.VirtualThreadPinned` (on by default, 20 ms threshold);
  `-Djdk.tracePinnedThreads` no longer has any effect (J491, VTG).
- Scoped values are final in 25 for one-way immutable context, inherited by
  `StructuredTaskScope` children; `ThreadLocal` is not deprecated (J506).
- Structured concurrency is a preview API through 27, with breaking changes in
  each preview (27: `open(UnaryOperator)`, a third type parameter, `join()`
  throws `ExecutionException`) — treat existing use as pinned to one JDK (J533).
- Correctness vs speed: if dropping the finding gives a wrong result or a hang,
  it is 4.3; if it only costs time or memory, it is 4.4.

## 7. Linter mapping

Run the project's own tools first (its Checkstyle/PMD/SpotBugs/Error Prone
configuration in `pom.xml`/`build.gradle`, `lefthook.yml`, or CI) and pass
their output to the review; never report "no issues" from a tool that did not
run. All of these compile the module or run build plugins, so on an untrusted
diff read CI results (`gh pr checks`) instead of running them, and name the
command for a human (`./gradlew checkstyleMain pmdMain spotbugsMain`,
`mvn spotbugs:check pmd:check checkstyle:check`, see `springboot-verification`).
Do not restate what a tool that ran already reported.

| Item | Caught by |
|---|---|
| java-raw-types | JAVAC `-Xlint:rawtypes,unchecked` |
| java-this-escape | JAVAC `-Xlint:this-escape` |
| java-lossy-compound | JAVAC `-Xlint:lossy-conversions`, EP `NarrowingCompoundAssignment` |
| java-switch-exhaustive (fall-through) | JAVAC `-Xlint:fallthrough`, CS `FallThrough`, `MissingSwitchDefault`; EP `MissingCasesInEnumSwitch` |
| java-sync-target (value-based) | JAVAC `-Xlint:identity` (`synchronization` is its deprecated alias); EP `SynchronizeOnNonFinalField` |
| java-static-via-instance | JAVAC `-Xlint:static` |
| deprecated / for-removal APIs | JAVAC `-Xlint:deprecation,removal` |
| preview use | JAVAC `-Xlint:preview` |
| java-optional-get | EP `OptionalNotPresent` |
| java-equals-hashcode | EP `EqualsHashCode` (error), SB `HE_EQUALS_USE_HASHCODE`, CS `EqualsHashCode` |
| java-reference-equality | EP `ReferenceEquality`, `BoxedPrimitiveEquality` (error), `BigDecimalEquals`; PMD `CompareObjectsWithEquals`, `UseEqualsToCompareStrings`; CS `StringLiteralEquality` |
| java-ignored-return | EP `ReturnValueIgnored`, `CheckReturnValue` (error); SB `RV_RETURN_VALUE_IGNORED` |
| java-expose-rep | SB `EI_EXPOSE_REP`, `EI_EXPOSE_REP2` |
| java-resource-close | SB `OBL_UNSATISFIED_OBLIGATION`, `OS_OPEN_STREAM`, `ODR_OPEN_DATABASE_RESOURCE`; EP `StreamResourceLeak`, `MustBeClosedChecker` (error); PMD `CloseResource`, `UseTryWithResources` |
| java-default-locale-charset | EP `DefaultCharset`, `JavaTimeDefaultTimeZone`; SB `DM_DEFAULT_ENCODING`; PMD `UseLocaleWithCaseConversions` |
| java-empty-catch | EP `EmptyCatch`, PMD `EmptyCatchBlock`, CS `EmptyCatchBlock` |
| java-catch-broad | PMD `AvoidCatchingGenericException`, CS `IllegalCatch`, SB `REC_CATCH_EXCEPTION` |
| java-lost-cause, java-print-stack-trace | PMD `PreserveStackTrace`, `AvoidPrintStackTrace`; EP `CatchAndPrintStackTrace` |
| java-interrupt | EP `InterruptedExceptionSwallowed` (experimental, off by default) |
| java-future-ignored | EP `FutureReturnValueIgnored` |
| java-shared-mutable | SB `IS2_INCONSISTENT_SYNC`; EP `GuardedBy` (error, needs `@GuardedBy` annotations) |
| java-dcl | EP `DoubleCheckedLocking`, SB `DC_DOUBLECHECK`, PMD `DoubleCheckedLocking` |
| java-volatile-rmw | SB `VO_VOLATILE_INCREMENT`, `AT_NONATOMIC_OPERATIONS_ON_SHARED_VARIABLE` |
| java-lock-try, java-wait-loop | EP `LockNotBeforeTry`, `WaitNotInLoop` |
| java-shared-formatter | SB `STCAL_STATIC_SIMPLE_DATE_FORMAT_INSTANCE` |
| java-threadlocal | EP `ThreadLocalUsage` |
| java-string-concat-loop | SB `SBSC_USE_STRINGBUFFER_CONCATENATION`, PMD `UseStringBufferForStringAppends` |
| java-boxing-hot | SB `DM_BOXED_PRIMITIVE_FOR_PARSING`, `DM_NUMBER_CTOR`; EP `BoxedPrimitiveConstructor` |
| java-legacy-sync-collections | EP `JdkObsolete` |
| java-objects-in-loop | PMD `AvoidInstantiatingObjectsInLoops` |
| java-null-collections, java-immutable-fields, java-mutable-static, java-utility-class | PMD `ReturnEmptyCollectionRatherThanNull`, `ImmutableField`, `MutableStaticState`, `UseUtilityClass`; CS `VisibilityModifier` |
| java-override | EP `MissingOverride`, CS `MissingOverride` |
| java-long-params, java-complexity | PMD `ExcessiveParameterList`, `CognitiveComplexity`; CS `ParameterNumber`, `CyclomaticComplexity`, `NPathComplexity` |
| naming and layout (4.7) | CS `google_checks.xml`: `TypeName`, `MethodName`, `MemberName`, `ConstantName`, `PackageName`, `AbbreviationAsWordInName`, `AvoidStarImport`, `OneTopLevelClass`, `MultipleVariableDeclarations` |
| java-security-handoff (SQL) | SB `SQL_NONCONSTANT_STRING_PASSED_TO_EXECUTE`, `SQL_PREPARED_STATEMENT_GENERATED_FROM_NONCONSTANT_STRING` |
| java-test-no-assert, java-test-junit4 | PMD `UnitTestShouldIncludeAssert`; EP `JUnit4TestNotRun` (error) |

No linter decides: JPA fetch plans and N+1, `@Transactional` proxy reach and
rollback rules, bean scope mistakes, executor sizing, whether a path is hot,
whether the runtime JDK makes a virtual-thread rule apply, or whether a
preview API is acceptable. Those are the review's work.
