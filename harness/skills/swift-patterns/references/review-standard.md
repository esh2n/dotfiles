# Swift review standard

The one Swift standard (apps on Apple platforms, server and command-line
Swift) for both the model writing Swift and `code-reviewer` reviewing a Swift
diff. There is no Swift reviewer agent; this file is the whole review
contract. It lists what to check and where the rule comes from; detail and
code live in the skills it links: `swift-patterns` (house style: `let` first,
value types, protocol-based dependency injection, Keychain for secrets) and
`swift-testing` (`@Test`, `#expect`, per-test isolation, coverage). Layering
questions go to `clean-architecture`; secrets, transport security, deep links
and authentication to `security-reviewer`; UI look to `ui-reviewer`.

Before applying any rule, read as text (never run SwiftPM or Xcode on a diff:
`Package.swift` is Swift code that SwiftPM executes, and macros and build
plugins run code the diff controls): `swift-tools-version` in `Package.swift`,
`swiftLanguageModes` and per-target `swiftLanguageMode`, `SWIFT_VERSION` and
`SWIFT_STRICT_CONCURRENCY` in `.xcconfig`/`project.pbxproj`,
`.enableUpcomingFeature(...)` entries, `.defaultIsolation(MainActor.self)` or
`-default-isolation MainActor`, and the deployment targets (iOS, macOS). The
language mode decides whether a data-race finding is a compile error (Swift
6 mode), a warning (Swift 5 mode with complete checking), or invisible (Swift
5 mode, minimal checking) (MG EnableDataRaceSafety). The default isolation
decides what unannotated code means (SE-0466). Current release on 2026-10-19
is Swift 6.4.1; 6.4 shipped 2026-09-15 (REL 6.4).

Sources are cited by the short name in the first column of section 1; a
`#fragment` after it names the anchor on that page.

## 1. Sources

| Short | Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|---|
| APIDG | Swift API Design Guidelines | https://www.swift.org/documentation/api-design-guidelines/ | Clarity at the point of use, naming by role, side-effect naming, argument labels, defaults, case, `#fileID`, documentation comments | Undated; fetched 2026-10-19. The typed-throws section SE-0413 promised is not on the page yet | Apache-2.0 (swift-org-website) |
| TSPL | The Swift Programming Language: Concurrency, Automatic Reference Counting, Error Handling, Memory Safety, Optional Chaining, The Basics | https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/ (and `.../automaticreferencecounting/`, `.../errorhandling/`, `.../memorysafety/`, `.../optionalchaining/`, `.../thebasics/`); read from https://github.com/swiftlang/swift-book/tree/main/TSPL.docc/LanguageGuide | Isolation, main actor, actors, `Sendable`, tasks, cancellation; strong cycles, `weak`/`unowned`, capture lists; `try?`/`try!`, typed throws, `defer`; exclusivity; assertions vs preconditions | `main`, Concurrency.md last changed 2026-09-15. `main` already describes `using @MainActor` (SE-0478), which is accepted but not implemented | Apache-2.0 with Runtime Library Exception |
| MG | Swift 6 Migration Guide: Data Race Safety, Common Compiler Errors, Incremental Adoption, Enable Data-Race Safety, Runtime Behavior, Source Compatibility, Migration Strategy, Feature Migration | https://www.swift.org/migration/documentation/migrationguide/; read from https://github.com/swiftlang/swift-migration-guide/tree/main/Guide.docc | Isolation domains, boundaries, `Sendable`, `@unchecked`, `nonisolated(unsafe)`, `@preconcurrency`, latent isolation, atomicity across suspension, `deinit`, continuations, task-group throttling | `main`, last commit 2026-01-02 | Apache-2.0 |
| SE | Swift Evolution proposals 0192, 0335, 0365, 0371, 0380, 0390, 0395, 0409, 0412, 0413, 0414, 0430, 0433, 0434, 0444, 0447, 0453, 0458, 0461, 0466, 0470, 0472, 0478, 0481, 0493, 0504, 0518, 0520 | https://github.com/swiftlang/swift-evolution/blob/main/proposals/ + file (for example `0461-async-function-isolation.md`) | Version-gated features; the status line gives the shipping release | Status lines read 2026-10-19 | Apache-2.0 |
| REL | swift.org release posts 6.0, 6.1, 6.2, 6.3, 6.4 | https://www.swift.org/blog/announcing-swift-6/, https://www.swift.org/blog/swift-6.1-released/, https://www.swift.org/blog/swift-6.2-released/, https://www.swift.org/blog/swift-6.3-released/, https://www.swift.org/blog/swift-6.4-released/ | What each release added, Swift Testing additions (ST-0006, ST-0021) | 2024-09-17, 2025-03-31, 2025-09-15, 2026-03-24, 2026-09-15 | Apache-2.0 (swift-org-website) |
| DIAG | Swift compiler diagnostic groups | https://github.com/swiftlang/swift/tree/main/userdocs/diagnostics (rendered at https://docs.swift.org/compiler/documentation/diagnostics/) | `-Werror`/`-Wwarning` groups: `ImplicitStrongCapture`, `NoUseUnstructuredThrowingTask`, `ExplicitSendable`, `UntypedThrows`, `ImplicitForceUnwrap`, `PerformanceHints`, `MutableGlobalVariable` | `main`; a page does not state the release it shipped in | Apache-2.0 |
| OPT | Writing High-Performance Swift Code | https://github.com/swiftlang/swift/blob/main/docs/OptimizationTips.rst | `final`, `private`, WMO, value types in `Array`, `ContiguousArray`, in-place mutation, copy-on-write for large values, `inout` over captures | Last changed 2024-07-22; written for compiler and stdlib developers | Apache-2.0 |
| STD | Apple Swift docs: `Array`, `Sendable`, Choosing Between Structures and Classes | https://developer.apple.com/documentation/swift/array, https://developer.apple.com/documentation/swift/sendable, https://developer.apple.com/documentation/swift/choosing-between-structures-and-classes | Copy-on-write, `reserveCapacity`, structs by default | Fetched 2026-10-19 (JSON form) | Apple terms; link only |
| SUI | SwiftUI docs: `State`, `StateObject`, `ObservedObject`, `Bindable`, Migrating from ObservableObject to the Observable macro | https://developer.apple.com/documentation/swiftui/state (and `/stateobject`, `/observedobject`, `/bindable`, `/migrating-from-the-observable-object-protocol-to-the-observable-macro`) | View-owned state, observation, bindings | Fetched 2026-10-19; `State` notes Xcode 27 builds use the `State()` macro | Apple terms; link only |
| ST | Swift Testing documentation: Migrating from XCTest, Parallelization, Testing asynchronous code, Testing for errors, Known issues | https://developer.apple.com/documentation/testing; read from https://github.com/swiftlang/swift-testing/tree/main/Sources/Testing/Testing.docc | `#require`, `init`/`deinit`, parallel by default, `confirmation`, `#expect(throws:)`, `withKnownIssue` | `main`, last changed 2026-09-19 | Apache-2.0 |
| SL | SwiftLint Rule Directory | https://realm.github.io/SwiftLint/rule-directory.html | Rule ids, default vs opt-in vs analyzer | 0.65.1 (2026-08-21) | MIT |
| HIG | Apple Human Interface Guidelines | https://developer.apple.com/design/human-interface-guidelines | UI-facing Swift only: accessibility, layout, platform conventions; linked, not restated | Fetched 2026-10-19 (accessibility page) | Apple terms; link only |

Not opened in this run and therefore not cited: SwiftFormat and
`swift-format` rule docs, the Swift Forums, WWDC sessions, Swift Concurrency
proposals not listed above, Xcode release notes. Treat any claim resting on
them as unverified. Android-equivalent items are out of scope.

## 2. Mindset

- Clarity at the point of use beats brevity; a name is judged at the call
  site, not the declaration (APIDG).
- Structs and enums by default; a class only for identity, Objective-C
  interop or shared reference semantics (STD Choosing Between Structures and
  Classes, `swift-patterns`).
- Every declaration has a static isolation: non-isolated, an actor instance,
  or a global actor. Know which one before judging concurrent code (MG
  DataRaceSafety `#Isolation-Domains`).
- State isolation statically (`@MainActor`, actors, `Sendable`); dynamic
  checks and unsafe opt-outs are migration tools with a removal plan (MG
  IncrementalAdoption, MigrationStrategy).
- Optionals and thrown errors are the failure channel; `!`, `try!` and `as!`
  are claims that must be provable from the code (TSPL Optional Chaining,
  Error Handling).
- ARC frees on the last strong reference; ownership direction (`weak`,
  `unowned`) is a design decision, not a lint fix (TSPL ARC).
- Formatting is SwiftFormat/`swift-format`'s job, not review.

## 3. Habits carried from other languages

| Habit | Do instead | Source |
|---|---|---|
| Treating `async`/`await` and actors as the same as other languages' | Similarities may be only superficial; learn isolation and `Sendable` | MG DataRaceSafety |
| Reasoning in threads; expecting to resume on the same thread | Code runs in isolation domains; after `await` no thread is guaranteed; the main actor is not the main thread | TSPL Concurrency (note in intro, `#The-Main-Actor`) |
| Blocking a thread to wait for async work (semaphore, `.Result`, `runBlocking`) | No safe sync-to-async bridge exists; convert top-down | TSPL Concurrency `#Defining-and-Calling-Asynchronous-Functions`, MG DataRaceSafety `#Suspension-Points` |
| Actor as a lock around a multi-step update | An actor is re-entrant at each `await`; keep the critical section synchronous | MG DataRaceSafety `#Atomicity` |
| Classes by default (Java, Objective-C) | Structures by default | STD Choosing Between Structures and Classes |
| Weak references as a cache (GC languages) | ARC frees at once on the last strong reference; weak is unsuitable for caching | TSPL ARC `#Weak-References` |
| Threading contracts in comments (Objective-C "called on main thread") | Express with `@MainActor`/`nonisolated`; Swift 6 traps when annotations lie | MG IncrementalAdoption `#Dealing-with-missing-isolation-annotations-in-Objective-C-libraries` |
| Exceptions to stop work (NSException, Java) | Swift errors are values; an Objective-C exception through Swift frames is undefined | ST Migrating from XCTest `#Continue-or-halt-after-test-failures`, TSPL Error Handling |
| One task or thread per work item | Throttle `TaskGroup.addTask` for large inputs | MG RuntimeBehavior |
| Checked exceptions: one error type per function | Typed throws only for module-internal, pass-through generic, or embedded code | SE-0413 `#When-to-use-typed-throws`, TSPL Error Handling `#Specifying-the-Error-Type` |
| Method families per option (Java overloads) | One method with defaulted trailing parameters | APIDG "Parameters" |
| `getFoo()`, type names inside identifiers | Nouns for side-effect-free members, names by role | APIDG "Naming" |

## 4. Review items

Format: `id` — trigger visible in a diff — what to check — why — source.
One-line items are general knowledge; detail appears only where judgment or
a threshold is involved. A finding names the concrete failure; "might race"
is not a finding.

### 4.1 Correctness and optionals

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| swift-force-unwrap | `!`, `as!`, `try!` on data from outside the function (input, decoding, network, dictionary lookup) | `guard let`/`if let`, `as?`, `try` with handling | Traps at runtime | TSPL Optional Chaining, Error Handling `#Disabling-Error-Propagation`, SL force_unwrapping/force_cast/force_try |
| swift-iuo | New `Type!` property outside outlets or two-phase init | Optional, or non-optional set in `init` | Implicit force unwrap traps | DIAG implicit-force-unwrap, TSPL ARC `#Unowned-References-and-Implicitly-Unwrapped-Optional-Properties` |
| swift-assert-check | `assert` guarding a condition production must hold (bounds, auth, invariants on input) | `precondition` or throw | Assertions are not evaluated in production builds | TSPL The Basics `#Assertions-and-Preconditions` |
| swift-unknown-default | `switch` over a non-frozen library/SDK enum without `@unknown default` | Add it | Error in Swift 6 mode; new cases arrive | SE-0192, MG SourceCompatibility |
| swift-exclusivity | Same variable passed to two `inout` parameters, or a mutating method given its own property | Copy to a local first | Compile-time or runtime exclusivity error | TSPL Memory Safety |
| swift-optional-bool | `Bool?`, optional collection where empty means absent | Non-optional, or an enum with named states | Three-state ambiguity | SL discouraged_optional_boolean, discouraged_optional_collection |
| swift-state-enum | Several flags/optionals encoding one state | Enum with associated values | Impossible states unrepresentable | `swift-patterns` |

### 4.2 Errors

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| swift-try-optional | `try?` where the caller needs the failure reason or must report it | `do`/`catch`, or propagate | The error is discarded | TSPL Error Handling `#Converting-Errors-to-Optional-Values` |
| swift-typed-throws-public | `throws(E)` on public API that republishes a dependency's error, or because "only one error exists today" | Untyped `throws` | Fixing the type blocks evolution; errors are usually propagated, not exhaustively handled | SE-0413 `#When-to-use-typed-throws`, TSPL Error Handling `#Specifying-the-Error-Type` |
| swift-task-error-lost | `Task { try ... }` whose handle is neither stored nor awaited | Handle inside, or keep the task and `try await task.value` | Thrown error is silently dropped (warning from 6.4) | SE-0520, DIAG no-use-throwing-unstructured-task, SL unhandled_throwing_task |
| swift-cancel-swallow | `catch { }` in a task body that also catches `CancellationError`; long loop never checking cancellation | Rethrow `CancellationError`; `Task.checkCancellation()`/`isCancelled` at loop heads | Cancellation is cooperative | TSPL Concurrency `#Task-Cancellation` |
| swift-defer-cleanup | Cleanup repeated on several exit paths | `defer` | One cleanup on every exit, including throws | TSPL Error Handling `#Specifying-Cleanup-Actions` |
| swift-continuation-once | `withChecked*Continuation`/`withUnsafe*Continuation` with a path that never resumes or resumes twice | Exactly one `resume` per path; prefer the checked variant | Missing resume hangs the task forever; double resume of a checked one traps | MG IncrementalAdoption `#Wrapping-Callback-Based-Functions` |
| swift-cancel-handler-state | State shared between `withTaskCancellationHandler`'s operation and its handler without synchronization | Make the shared part `Sendable`/locked | Handler runs while the task still runs | TSPL Concurrency `#Task-Cancellation` |

### 4.3 Concurrency

Read section 6 first. A finding states the isolation of each side.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| swift-mutable-global | Global or `static var`, or `static let` of a non-`Sendable` type | `let`, a global actor, or a `Sendable` type; `nonisolated(unsafe)` only with the guarding lock named in a comment | Reachable from every domain; error in Swift 6 mode | MG CommonProblems `#Unsafe-Global-and-Static-Variables`, SE-0412 |
| swift-unchecked-sendable | New `@unchecked Sendable` | Every mutable stored property protected by a named lock, `Mutex` or queue; otherwise an actor, global actor or value type | The compiler stops checking; not a first approach | MG CommonProblems `#Manual-Synchronization`, DataRaceSafety `#Reference-Types` |
| swift-retroactive-sendable | `extension T: @retroactive @unchecked Sendable` on a dependency type | Documented thread safety of `T` cited; avoid on public API | Library's guarantees may not match `Sendable` | MG CommonProblems `#Retroactive-Sendable-Conformance` |
| swift-public-sendable | Public value type crossing domains with no explicit `Sendable`; removal of a `Sendable` conformance | Explicit conformance; `~Sendable` (6.4) when deliberately not `Sendable`; treat removal as API-breaking | Implicit `Sendable` is not visible outside the module | MG CommonProblems `#Implicitly-Sendable-Types`, SE-0518, DIAG explicit-sendable-annotations |
| swift-sendable-checked-class | `final class X: Sendable` with `var` stored properties, or non-final | Final, `let` properties of `Sendable` types (or isolated/locked storage) | Only final classes with no unprotected mutable state are checkable | MG CommonProblems `#Sendable-Reference-Types` |
| swift-preconcurrency | New `@preconcurrency import` or `@preconcurrency` conformance | Temporary, tied to an unmigrated dependency; prefer fixing the protocol's isolation | Downgrades diagnostics; conformance form adds runtime checks | MG CommonProblems `#Preconcurrency-Import`, `#Preconcurrency-Conformance` |
| swift-latent-mainactor | Non-isolated function or type that hands non-`Sendable` values straight to `@MainActor` code | Mark it `@MainActor`; offload only targeted `nonisolated` work | Most common latent isolation problem; removes the boundary | MG CommonProblems `#Latent-Isolation` |
| swift-dynamic-hop | `MainActor.run`, `DispatchQueue.main.async`, `assumeIsolated` added instead of a static annotation | `@MainActor` on the declaration | Static isolation lets the compiler verify and insert hops | MG IncrementalAdoption `#Explicit-MainActor-Context` |
| swift-actor-reentrancy | Actor or `@MainActor` method reads state, `await`s, then writes based on the read | Re-read after the `await`, or move the read-modify-write into a synchronous method | State may change at every suspension point | MG DataRaceSafety `#Atomicity`, TSPL Concurrency `#Actors` |
| swift-unstructured-task | `Task {}` or `Task.detached` where `async let` or a task group fits; `Task.detached` to "get off the main actor" | Structured concurrency; under 6.2+ `NonisolatedNonsendingByDefault`, `@concurrent` for CPU work | Unstructured tasks get no automatic cancellation or awaiting; detached drops priority and task-locals | TSPL Concurrency `#Unstructured-Concurrency`, SE-0461, `swift-patterns` |
| swift-task-fanout | `addTask` once per element of an unbounded input | Cap in-flight tasks (start N, add one as one finishes) | Each pending task allocates | MG RuntimeBehavior |
| swift-blocking-async | `DispatchSemaphore.wait`, `Thread.sleep`, synchronous file/network I/O, or lock held across `await` inside async code | `await` an async API; move blocking work off the cooperative pool | The runtime expects code never to block on future work | MG DataRaceSafety `#Suspension-Points`, TSPL Concurrency |
| swift-deinit-isolation | `deinit` of an actor or `@MainActor` class calling isolated members, or a `Task` in `deinit` capturing `self` | `isolated deinit` (6.2+), or a task that captures only the values it needs | `deinit` is non-isolated by default; extending `self`'s lifetime from `deinit` crashes | MG CommonProblems `#Non-Isolated-Deinitialization`, SE-0371 |
| swift-unmarked-sendable-closure | Callback from an unmigrated or Objective-C API that runs on another queue, used from `@MainActor` code without `@Sendable` | Annotate the closure `@Sendable` and hop explicitly | Compiles, then traps at runtime | MG IncrementalAdoption `#Unmarked-Sendable-Closures` |
| swift-isolated-conformance | `@MainActor` type satisfying a non-isolated protocol through `nonisolated` workarounds or `@preconcurrency` | Isolated conformance `extension T: @MainActor P` (6.2+), or isolate the protocol | Keeps the type's isolation checked | SE-0470, MG CommonProblems `#Protocol-Conformance-Isolation-Mismatch` |
| swift-lock-choice | New class hand-rolling a queue or `NSLock` around one value | `Mutex` from `Synchronization` (6.0+) or an actor; existing working locks need not be removed | `Mutex` is `Sendable` and scopes access to a closure | SE-0433, MG CommonProblems `#Manual-Synchronization` |

### 4.4 Memory

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| swift-closure-cycle | Escaping closure stored by `self` or by something `self` owns (handler property, timer, observer token, sink, `lazy var` closure) that uses `self` | Capture list `[weak self]`, or `[unowned self]` when lifetimes are equal | Strong reference cycle; `deinit` never runs | TSPL ARC `#Strong-Reference-Cycles-for-Closures`, `#Defining-a-Capture-List` |
| swift-unowned-lifetime | `unowned` where the referent can be freed first (async callbacks, delegates, cached closures) | `weak` unless same or longer lifetime is provable | Accessing a freed `unowned` reference is a runtime error | TSPL ARC `#Unowned-References`, SL unowned_variable_capture |
| swift-unowned-unsafe | `unowned(unsafe)`, `Unmanaged` | A measured reason; otherwise `weak`/`unowned` | No runtime check; use-after-free | TSPL ARC `#Unowned-References`, OPT "unmanaged references" |
| swift-delegate-strong | Delegate, parent or observer back-reference stored strongly | `weak var` on a class-constrained protocol | Child keeps parent alive | TSPL ARC `#Weak-References`, SL weak_delegate, class_delegate_protocol |
| swift-implicit-strong-capture | `[weak self]` in an inner closure nested in an outer escaping closure with no capture list | Capture list on the outer closure too | The outer closure captures `self` strongly | DIAG implicit-strong-capture |
| swift-weak-observer | Logic in `didSet` of a `weak` property expected to run on deallocation | Do not rely on it | Observers are not called when ARC sets `nil` | TSPL ARC `#Weak-References` |

### 4.5 Performance

Only on a path shown to be hot, with a size or count; otherwise a question.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| swift-cow-copy | Mutating a collection that shares storage (copied parameter, returned property) inside a loop; reassign-to-mutate (`x = x.appending(...)`) | Mutate in place, pass `inout` | First mutation of shared storage copies the whole buffer | STD Array "Modifying Copies of Arrays", OPT "in-place mutation" |
| swift-large-value | Large struct (many stored properties or nested collections) copied in a hot loop | Copy-on-write wrapper with `isKnownUniquelyReferenced`, or a class when identity fits | Copies cost per stored property | OPT "copy-on-write semantics for large values" |
| swift-reserve | `append` in a loop with a known final count | `reserveCapacity(_:)` first | Avoids repeated reallocation | STD Array "Growing the Size of an Array" |
| swift-final | Class or member never meant to be overridden, without `final`/`private` | Add `final` or reduce access | Enables direct dispatch | OPT "Use 'final'", "Use 'private'" |
| swift-contiguous | `[SomeClass]` on a hot path with no `NSArray` bridging | `ContiguousArray` | Avoids bridging checks | OPT "ContiguousArray" |
| swift-escaping-capture | Escaping closure used only locally, capturing a `var` | Non-escaping closure or `inout` | Avoids a heap box and retain traffic | OPT "Pass var as an inout" |
| swift-untyped-throws-hot | Untyped `throws` in embedded or measured-hot code | Typed throws | `any Error` allocates and is reference counted | DIAG untyped-throws, TSPL Error Handling `#Specifying-the-Error-Type` |
| swift-collection-idiom | `count == 0`, `filter{}.first`, `filter{}.count > 0` | `isEmpty`, `first(where:)`, `contains(where:)` | Avoids full traversal | SL empty_count, first_where, contains_over_filter_count |

Not findings: `final` on a cold class, `ContiguousArray` with no profile,
"use a struct" for a type whose identity matters, `unowned(unsafe)` proposed
for speed without a measurement.

### 4.6 API design

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| swift-needless-words | Type information repeated in a name (`removeElement(_ element:)`, `stringValue: String`) | Name by role; omit words the type already says | Clarity at the point of use | APIDG "Omit needless words" |
| swift-side-effect-name | Mutating method named as a noun, or non-mutating as a verb; mismatched pair (`sort`/`sorted`, `formUnion`/`union`) | Imperative verb for mutating, noun or `-ed`/`-ing` form for non-mutating | Reader infers mutation from the name | APIDG "Strive for Fluent Usage" |
| swift-bool-name | Boolean property not reading as an assertion (`empty`, `visible`) | `isEmpty`, `isVisible`, `intersects(_:)` | Reads correctly in conditions | APIDG |
| swift-arg-labels | First-argument label wrong: label on a value-preserving conversion `init`, missing preposition label, unlabeled ambiguous argument | Omit for value-preserving conversions; label from the preposition; label all others | Call site reads as a phrase | APIDG "Argument Labels" |
| swift-default-params | New overload family differing only by trailing options | Defaulted parameters at the end | Lower cognitive load | APIDG "Parameters" |
| swift-case | Types not `UpperCamelCase`, others not `lowerCamelCase`; acronyms mixed (`Url`, `userSmtpServer`) | Uniform case for common acronyms (`url`, `userSMTPServer`) | Convention | APIDG "Follow case conventions", SL identifier_name, type_name |
| swift-protocol-name | Capability protocol not `-able`/`-ible`/`-ing`; "is-a" protocol not a noun | Rename | Convention | APIDG |
| swift-factory-make | Factory method not beginning with `make` | `makeX(...)` | Convention | APIDG |
| swift-complexity-doc | Computed property doing O(n) or I/O without a doc note | Document complexity or make it a method | Readers assume property access is cheap | APIDG "Document the complexity" |
| swift-doc-comment | New public declaration without a summary doc comment | Add one | Hard-to-describe API signals a design problem | APIDG "Write a documentation comment" |
| swift-free-function | New free function with an obvious `self` | Method or property | Free functions are for no-`self`, unconstrained generic, or domain notation | APIDG "Prefer methods and properties" |
| swift-return-overload | Overloads differing only by return type | Distinct names | Ambiguous with type inference | APIDG "Methods can share a base name" |
| swift-any-param | Overloads where one takes `Any`/`AnyObject`/unconstrained generic | Distinct labels or names | Ambiguous overload resolution | APIDG "Take extra care with unconstrained polymorphism" |
| swift-fileid | `#file`/`#filePath` in production logging | `#fileID` | Saves space, protects developer paths | APIDG "Parameters" |
| swift-public-import | `public import` of a dependency used only internally | `internal import` (6.0+) | Leaks the dependency to clients | SE-0409 |
| swift-existential-any | Protocol used as a type without `any`; existential where `some`/generic suffices | Write `any P`; prefer `some P` | Makes existential cost visible | SE-0335 |

### 4.7 SwiftUI

Applies to files importing SwiftUI. Visual judgments go to `ui-reviewer`
with the HIG.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| swift-ui-state-private | `@State`/`@StateObject` not `private` | `private` | A memberwise init could set it and fight SwiftUI's storage | SUI State, StateObject, SL private_swiftui_state |
| swift-ui-state-default | `@State var model = HeavyModel()` in a frequently rebuilt view | Create in `.task` or the owner | The default value is built on every view init | SUI State "Store observable objects" |
| swift-ui-observableobject-in-state | `ObservableObject` stored in `@State` | `@StateObject`, or migrate to `@Observable` | View updates only when the reference changes | SUI State (note) |
| swift-ui-observed-owner | `@ObservedObject var m = Model()` (default value) | Owner uses `@StateObject`/`@State`; `@ObservedObject` only for inputs | Object recreated or lost on view rebuild | SUI ObservedObject |
| swift-ui-observed-observable | `@ObservedObject` wrapping an `@Observable` type | Plain property; `@Bindable` when bindings are needed | Not supported for Observable types | SUI ObservedObject (note), Bindable |
| swift-ui-observation | New `ObservableObject`/`@Published` when the deployment target is iOS 17/macOS 14 or later | `@Observable` with `@State`, `@Environment`, `@Bindable` | Updates only views that read the changed property | SUI Migrating to the Observable macro, SE-0395 |
| swift-ui-stateobject-input | `StateObject(wrappedValue:)` from a view input expected to refresh when the input changes | Change view identity with `.id(...)` | The autoclosure runs only on first initialization | SUI StateObject "Initialize state objects using external data" |
| swift-ui-a11y | `Image` without an accessibility label; custom controls without traits | Label or mark decorative; follow HIG | VoiceOver users | SL accessibility_label_for_image, HIG |

### 4.8 Testing

Patterns live in `swift-testing`; whether tests protect behaviour at all is
`test-reviewer`'s question.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| swift-test-framework | New tests written as `XCTestCase` in a target that has Swift Testing | `@Test`/`#expect`; mixing assertions is supported from 6.4 | House default; incremental migration | `swift-testing`, ST Migrating from XCTest, REL 6.4 (ST-0021) |
| swift-test-require | `#expect(x != nil)` followed by `x!`, or `XCTUnwrap` ported as a force unwrap | `let x = try #require(optional)` | Stops the test with an issue instead of trapping | ST Migrating from XCTest `#Check-for-optional-values` |
| swift-test-halt | `continueAfterFailure = false` in async XCTest | `#require`, or Swift Testing | Halting throws an Objective-C exception; through Swift frames that is undefined | ST Migrating from XCTest `#Continue-or-halt-after-test-failures` |
| swift-test-setup | `setUp`/`tearDown` ported literally; shared fixtures in `static var` | `init`/`deinit` on the suite; fresh instance per test | Per-test isolation | ST Migrating from XCTest `#Convert-setup-and-teardown-functions`, `swift-testing` |
| swift-test-parallel | Tests touching global state, files or singletons with no ordering | Remove the shared state; `.serialized` serializes only a parameterized test or a suite | Tests run in parallel in one process by default | ST Parallelization |
| swift-test-async-wait | `sleep`, `Task.sleep`, or polling to wait for an event; `XCTestExpectation` ported | `await` directly, or `confirmation(expectedCount:)` | Timing-based tests are flaky | ST Testing asynchronous code |
| swift-test-throws | `do { try f(); Issue.record() } catch {}`, or `#expect(throws: (any Error).self)` where a specific error matters | `#expect(throws: SpecificError.self)` or the error value; inspect the returned error (6.1+) | Any error would pass | ST Testing for errors, REL 6.1 (ST-0006) |
| swift-test-disabled | Failing test commented out or `.disabled` with no bug link | `withKnownIssue` plus a bug trait | Keeps it running and detects the fix | ST Known issues |
| swift-test-loop | Loop over inputs inside one test body | `@Test(arguments:)` | Each case reported and run separately | `swift-testing` |

## 5. Version-gated modern features

Gate on the oldest toolchain the project supports and on the language mode,
never on the latest release. Swift 6 language mode is opt-in per target;
upcoming features (`.enableUpcomingFeature`) turn on parts of a later mode
early, and `swift package migrate --to-feature` applies fix-its (MG
FeatureMigration).

| Version | Suggest | Old form still right when | Source |
|---|---|---|---|
| 5.9 | `if`/`switch` expressions; macros; parameter packs; `~Copyable` structs/enums; Observation (`@Observable`) | Multi-statement branches (expression forms allow one expression per branch); deployment target below iOS 17/macOS 14 keeps `ObservableObject` | SE-0380, SE-0390, SE-0395, SUI Migrating |
| 5.10 | Complete concurrency checking as warnings; strict globals | — | SE-0412, MG EnableDataRaceSafety |
| 6.0 | Swift 6 language mode (data races are errors); typed throws; `sending` and region-based isolation; `Mutex`, `Atomic`; access-level imports; Swift Testing; `Int128` | Per-target `swiftLanguageMode` while still supporting pre-6 toolchains needs a separate `Package@swift-5.9.swift`; untyped `throws` for public API | REL 6.0, SE-0413, SE-0414, SE-0430, SE-0433, SE-0409, MG EnableDataRaceSafety |
| 6.1 | `nonisolated` on types and extensions; inferred `withTaskGroup` child type; trailing commas everywhere; member import visibility; test scoping traits | — | REL 6.1, SE-0444 |
| 6.2 | `-default-isolation MainActor` / `.defaultIsolation(MainActor.self)`; `NonisolatedNonsendingByDefault` with `@concurrent`; isolated conformances; `isolated deinit`; `Task.immediate`; task names; `InlineArray`, `Span`; opt-in strict memory safety; `Observations`; exit tests, attachments | Default main-actor isolation suits apps, scripts and executables; keep `nonisolated` for libraries used from any domain and for highly concurrent servers. Both are source-incompatible switches made per module | REL 6.2, SE-0466, SE-0461, SE-0470, SE-0371, SE-0472, SE-0453, SE-0447, SE-0458 |
| 6.3 | `weak let` (enables `Sendable` final classes holding weak references); warning-severity test issues, test cancellation | Floor below 6.3: `weak var` | REL 6.3, SE-0481 |
| 6.4 (2026-09-15) | `async` calls in `defer`; `withTaskCancellationShield` for cleanup; `~Sendable`; warning on discarded throwing `Task`; `some P?` without parentheses; `@diagnose` warning control; module selectors `::`; `UniqueArray`/`RigidArray`, `UniqueBox`; XCTest and Swift Testing assertions interoperate | Floor below 6.4: run async cleanup in a task the caller awaits | REL 6.4, SE-0493, SE-0504, SE-0518, SE-0520 |
| Accepted, not shipped | `default @MainActor` per file (SE-0478; TSPL `main` shows an earlier `using` spelling) | Not available in any release yet; do not suggest | SE-0478 |

Xcode 27 builds replace the `State` property wrapper with the `State()`
macro (SUI State); review the source spelling, not the expansion.

## 6. Concurrency model

- Swift 6 language mode turns data-race safety into compile-time errors;
  complete checking in Swift 5 mode reports the same issues as warnings
  (`-strict-concurrency=complete`, `SWIFT_STRICT_CONCURRENCY = complete`,
  `.enableUpcomingFeature("StrictConcurrency")`) — MG EnableDataRaceSafety.
- Every declaration is non-isolated, isolated to an actor instance, or
  isolated to a global actor (`@MainActor`). Mutable state is reachable from
  one domain at a time; non-isolated code cannot touch another domain's
  state — MG DataRaceSafety `#Isolation-Domains`.
- Isolation is inferred: subclasses take the superclass's, a global-actor
  protocol conformance declared on the type spreads to the type, closures
  inherit the context they are formed in, and `Task {}` inherits the
  enclosing actor while `Task.detached` does not — MG DataRaceSafety
  `#Isolation-Inference-and-Inheritance`, TSPL Concurrency
  `#Unstructured-Concurrency`.
- Values cross a boundary only when safe: `Sendable` types (value types made
  of `Sendable` parts, actors, global-actor-isolated types, checked final
  classes), or non-`Sendable` values the compiler proves are disconnected
  (region-based isolation, `sending`) — MG DataRaceSafety
  `#Isolation-Boundaries`, SE-0414, SE-0430.
- `await` marks a possible suspension, not a guaranteed one. Actors give
  mutual exclusion but not atomicity across `await`; a critical section must
  be synchronous — MG DataRaceSafety `#Atomicity`.
- Cross-domain calls suspend instead of blocking; code must not block a
  thread on future work — MG DataRaceSafety `#Suspension-Points`.
- Before 6.2's upcoming feature, a non-isolated `async` function always
  runs on the global concurrent executor. With
  `NonisolatedNonsendingByDefault` it runs on the caller's actor, and
  `@concurrent` opts back into the concurrent executor. Which rule applies
  is per module; state it in the finding — SE-0461, REL 6.2.
- With `-default-isolation MainActor`, unannotated code in the module is
  `@MainActor`; "add `@MainActor`" findings are then redundant, and "this
  runs on the main thread" is the default — SE-0466.
- Dynamic checks (`@preconcurrency`, `assumeIsolated`, SE-0423 enforcement)
  trap at runtime when an annotation is wrong; a crash in an Objective-C
  callback after migration usually means a missing `nonisolated` or
  `@Sendable` upstream — MG IncrementalAdoption.
- Unsafe opt-outs (`@unchecked Sendable`, `nonisolated(unsafe)`,
  `@preconcurrency`) mark follow-up work; the migration guide's rule is
  "express what is true now", then refactor — MG MigrationStrategy.
- Correctness vs speed: a race, a lost update or a swallowed cancellation is
  4.3; work on the wrong executor that is only slow is 4.5.

## 7. Linter mapping

Run the project's own checks first (`.swiftlint.yml`, `.swiftformat`,
`.swift-format`, `lefthook.yml`, `.pre-commit-config.yaml`, CI results via
`gh pr checks`) and pass their output to the review; never report "no
issues" from a tool that did not run. `swiftlint lint` reads source without
building it; the analyzer rules listed below are not part of a plain lint
run (SL). Compiler
diagnostics come from CI or a build the owner ran; do not build the diff
yourself (see the preamble). Do not restate what a tool that ran already
reported.

Compiler first: in Swift 6 mode the data-race items of 4.3 are errors;
diagnostic groups can be raised with `-Werror <group>` or SwiftPM
`treatWarning`, or set in source with `@diagnose` from 6.4 (DIAG
diagnostic-groups, REL 6.2, REL 6.4).

| Item | Compiler | SwiftLint rule | SwiftLint default |
|---|---|---|---|
| swift-force-unwrap | — | force_unwrapping; force_cast; force_try | no; yes; yes |
| swift-iuo | `ImplicitForceUnwrap` group (off by default) | implicitly_unwrapped_optional | no |
| swift-unknown-default | Error in Swift 6 mode | — | — |
| swift-exclusivity | Compile-time error, runtime trap | — | — |
| swift-optional-bool | — | discouraged_optional_boolean, discouraged_optional_collection | no |
| swift-task-error-lost | `NoUseUnstructuredThrowingTask` (6.4) | unhandled_throwing_task | no |
| swift-mutable-global, swift-unchecked-sendable checks, boundary crossings | Swift 6 mode / complete checking; `MutableGlobalVariable` group | — | — |
| swift-public-sendable | `ExplicitSendable` group (opt-in) | — | — |
| swift-delegate-strong | — | weak_delegate; class_delegate_protocol | no; yes |
| swift-unowned-lifetime | — | unowned_variable_capture | no |
| swift-implicit-strong-capture | `ImplicitStrongCapture` group | — | — |
| swift-untyped-throws-hot | `UntypedThrows`, `PerformanceHints` groups (off by default) | — | — |
| swift-collection-idiom | — | empty_count, first_where, contains_over_filter_count | no |
| swift-case | — | identifier_name, type_name | yes |
| swift-ui-state-private | — | private_swiftui_state | no |
| swift-ui-a11y | — | accessibility_label_for_image | no |
| async without suspension | — | async_without_await | no |
| unused code and imports | — | unused_declaration, unused_import (analyzer) | analyzer |

No tool decides: which isolation a type should have, whether an
`@unchecked Sendable` type is really synchronized, whether an `await` splits
a critical section, ownership direction (`weak` vs `unowned`), whether a
path is hot, whether typed throws fits an API, whether a version gate or
default isolation applies. Those are the review's work.
