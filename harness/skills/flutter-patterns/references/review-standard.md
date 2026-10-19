# Dart and Flutter review standard

The one Dart/Flutter standard for both the model writing Dart and
`code-reviewer` reviewing a Dart diff. It lists what to check and where the
rule comes from. Layering questions go to `clean-architecture`; whether
tests protect behaviour to `test-reviewer`; secrets, insecure storage,
cleartext traffic, deep-link handlers, exported Android components and iOS
URL schemes to `security-reviewer`; SQL to
`sql-tuning/references/review-standard.md`.

Before applying any rule, read as text (never run `flutter` or `dart run`
on a diff: they execute Gradle, CocoaPods, Xcode build scripts and
`build_runner` generators): the `environment: sdk:` lower bound in
`pubspec.yaml` (it sets the Dart language version), the Flutter
constraint if any, the target platforms, and `analysis_options.yaml`
(which lint set is included, which rules are added or disabled, the
`strict-*` modes). A rule gated on a version does not apply below it.

Sources are cited by the short name in the first column of section 1; a
quoted topic after it (for example ED "AVOID catches without on clauses")
names the section of that page.

## 1. Sources

| Short | Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|---|
| ED | Effective Dart: Style, Documentation, Usage, Design | https://dart.dev/effective-dart/style, https://dart.dev/effective-dart/documentation, https://dart.dev/effective-dart/usage, https://dart.dev/effective-dart/design | Naming, imports, formatting, doc comments, `late`, `async`, catches, collections, equality, class modifiers, type annotations | Fetched 2026-10-19 | CC BY 4.0 text, BSD-3-Clause code (dart-lang/site-www LICENSE) |
| DL | Dart language docs: Understanding null safety, Type system, Records, Patterns, Class modifiers, Error handling, Dot shorthands | https://dart.dev/null-safety/understanding-null-safety, https://dart.dev/language/type-system, https://dart.dev/language/records, https://dart.dev/language/patterns, https://dart.dev/language/class-modifiers, https://dart.dev/language/error-handling, https://dart.dev/language/dot-shorthands | `!`, `late`, flow analysis, promotion, soundness and `dynamic`, record equality, exhaustive `switch` over `sealed` types | Fetched 2026-10-19 | CC BY 4.0 / BSD-3-Clause |
| DC | Dart: Concurrency, Isolates, Asynchronous programming, Futures and error handling | https://dart.dev/language/concurrency, https://dart.dev/language/isolates, https://dart.dev/libraries/async/async-await, https://dart.dev/libraries/async/futures-error-handling | Event loop per isolate, message passing, "isolates aren't threads", races still possible, web has no isolates | Fetched 2026-10-19 | CC BY 4.0 / BSD-3-Clause |
| DREL | Dart SDK CHANGELOG; dart.dev What's new; Language evolution | https://github.com/dart-lang/sdk/blob/main/CHANGELOG.md, https://dart.dev/resources/whats-new, https://dart.dev/resources/language/evolution | Version-gated language and library features 3.0–3.13 | Latest stable 3.13 (3.13.0 released 2026-08-12; Flutter 3.47.7 ships 3.13.5). 3.14 and 3.15 are listed as unreleased | BSD-3-Clause (SDK repo) / CC BY 4.0 |
| DMAC | Dart blog: An update on Dart macros & data serialization | https://dart.dev/blog/an-update-on-dart-macros-data-serialization | Macros work stopped; augmentations and `build_runner` instead | 2025-01-29 | CC BY 4.0 |
| FPB | Flutter: Performance best practices | https://docs.flutter.dev/perf/best-practices | `build()` cost, `setState` scope, widgets vs helper methods, `saveLayer`, opacity and clipping, lazy lists, intrinsics, 16 ms frames, `operator ==` on widgets, `StringBuffer` | Site reflects Flutter 3.47; fetched 2026-10-19 | CC BY 3.0 text, BSD code (flutter/website LICENSE) |
| FPROF | Flutter: App performance profiling; Rendering performance | https://docs.flutter.dev/perf/ui-performance, https://docs.flutter.dev/perf/rendering-performance | Measure on a physical device in profile mode; UI thread vs raster thread | Fetched 2026-10-19 | CC BY 3.0 / BSD |
| FISO | Flutter: Concurrency and isolates | https://docs.flutter.dev/perf/isolates | `Isolate.run`, `compute` on web runs on the main thread, no `rootBundle`/`dart:ui` in spawned isolates, background platform channels | Fetched 2026-10-19 | CC BY 3.0 / BSD |
| FIMP | Flutter: Impeller rendering engine | https://docs.flutter.dev/perf/impeller | Default renderer per platform; shaders compiled at build time; web uses Skia | Fetched 2026-10-19 (states Flutter 3.47) | CC BY 3.0 / BSD |
| FAPI | Flutter API reference: `StatefulWidget`, `State.setState`, `State.dispose`, `BuildContext.mounted`, `Key`, `Opacity`, `Image`, `ImageCache`, `ListView`, `ScrollView.shrinkWrap`, `IntrinsicHeight`, `RepaintBoundary`, `BackdropFilter`, `AnimatedBuilder`, `FutureBuilder`, `MediaQuery`, `SafeArea`, `AppLifecycleListener`, `matchesGoldenFile` | https://api.flutter.dev/flutter/widgets/StatefulWidget-class.html (one page per symbol under https://api.flutter.dev/flutter/) | API contracts and the "Performance considerations" sections | Tracks stable 3.47; fetched 2026-10-19 | BSD-3-Clause (flutter/flutter LICENSE) |
| FA11Y | Flutter: Accessibility; UI design and styling; Assistive technologies; Accessibility testing | https://docs.flutter.dev/ui/accessibility, https://docs.flutter.dev/ui/accessibility/ui-design-and-styling, https://docs.flutter.dev/ui/accessibility/assistive-technologies, https://docs.flutter.dev/ui/accessibility/accessibility-testing | 48x48 tap targets, 4.5:1 contrast, OS font scaling, `Semantics`, Guideline API (`meetsGuideline`) | Fetched 2026-10-19 | CC BY 3.0 / BSD |
| FI18N | Flutter: Internationalizing Flutter apps | https://docs.flutter.dev/ui/internationalization | `flutter_localizations`, ARB files, placeholders, plurals, selects, `NumberFormat`/`DateFormat` | Fetched 2026-10-19 | CC BY 3.0 / BSD |
| FSM | Flutter: Ephemeral vs app state; State management approaches | https://docs.flutter.dev/data-and-backend/state-mgmt/ephemeral-vs-app, https://docs.flutter.dev/data-and-backend/state-mgmt/options | No universal rule; `setState`, `ValueNotifier`, `InheritedWidget`, packages | Fetched 2026-10-19 | CC BY 3.0 / BSD |
| FARCH | Flutter: Architecture recommendations | https://docs.flutter.dev/app-architecture/recommendations | Data/UI layers, repositories, MVVM, no logic in widgets, unidirectional flow, immutable models, DI, testing with fakes | Fetched 2026-10-19 | CC BY 3.0 / BSD |
| FNAV | Flutter: Navigation and routing | https://docs.flutter.dev/ui/navigation | Named routes not recommended; Router for deep links | Fetched 2026-10-19 | CC BY 3.0 / BSD |
| FERR | Flutter: Handling errors | https://docs.flutter.dev/testing/errors | `FlutterError.onError`, `PlatformDispatcher.instance.onError`, `ErrorWidget.builder` | Fetched 2026-10-19 | CC BY 3.0 / BSD |
| FTEST | Flutter: Widget testing introduction; Testing overview; Integration tests; Performance profiling with integration tests | https://docs.flutter.dev/cookbook/testing/widget/introduction, https://docs.flutter.dev/testing/overview, https://docs.flutter.dev/testing/integration-tests, https://docs.flutter.dev/cookbook/testing/integration/profiling | `pumpWidget`, `pump`, `pumpAndSettle`, test kinds, `traceAction`/`TimelineSummary` | Fetched 2026-10-19 | CC BY 3.0 / BSD |
| LINT | Dart linter rules index and rule pages; `package:lints` 6.1.0; `package:flutter_lints` 6.0.0 and its CHANGELOG | https://dart.dev/tools/linter-rules, https://pub.dev/packages/lints, https://pub.dev/packages/flutter_lints | Rule names and set membership (read from the published 6.1.0 / 6.0.0 archives) | lints 6.1.0, flutter_lints 6.0.0 (latest on pub.dev 2026-10-19; both need Dart 3.8) | BSD-3-Clause (package LICENSE files) |
| ANA | Dart: Customizing static analysis; dart format | https://dart.dev/tools/analysis, https://dart.dev/tools/dart-format | `strict-casts`, `strict-inference`, `strict-raw-types`; formatter, `page_width`, trailing commas | Fetched 2026-10-19 | CC BY 4.0 / BSD-3-Clause |
| FREL | Flutter release archive (macOS JSON) | https://storage.googleapis.com/flutter_infra_release/releases/releases_macos.json | Latest stable and its Dart version | 3.47.7, 2026-10-08, Dart 3.13.5 | Google-hosted data |

Every URL above was opened in this run (HTTP 200). Not opened: the
Medium copy of the macros post (403; the dart.dev copy was read instead),
and the feature specifications linked from the CHANGELOG.

## 2. Mindset

- Sound null safety: a non-nullable type never holds `null`; `!` and
  `late` are runtime-checked claims the compiler cannot verify (DL null
  safety "Not-null assertion operator", "Late variables").
- Model alternatives as `sealed` hierarchies or records and handle them
  with exhaustive `switch`; the compiler then finds the missing case (DL
  class modifiers, patterns).
- All Dart code runs in isolates; each has its own memory and one event
  loop. Anything synchronous and long blocks that isolate's frames (DC).
- A widget is a cheap, immutable description; cost comes from how much
  of the tree rebuilds, lays out and paints, and how often (FPB "Control
  build() cost", FAPI `StatefulWidget` "Performance considerations").
- Keep logic out of widgets: views render state from a view model and send
  events back; data flows one way (FARCH).
- A performance claim names the thread (UI or raster), the trigger and its
  frequency, and is measured in profile mode on a physical device before
  anyone calls it verified (FPROF).
- `dart format` output and lint-set findings are not up for review (ED
  "DO format your code using dart format", section 7).

## 3. Habits carried from other languages

| Habit | Do instead | Source |
|---|---|---|
| Treating isolates as shared-memory threads: mutating a global in a spawned isolate and expecting the main isolate to see it | Send results back as messages (`Isolate.run` return value, `SendPort`); globals are per isolate | https://dart.dev/language/concurrency ("Isolates aren't threads"), https://docs.flutter.dev/perf/isolates ("Limitations of Isolates") |
| Adding locks or assuming no concurrency bugs because Dart is single-threaded | Isolates prevent data races, not race conditions: interleaved `await`s inside one isolate can still read stale state | https://dart.dev/language/concurrency ("Isolates") |
| Imperative UI updates: keeping a widget reference and mutating it, or storing `BuildContext` for later | Change state and let `build` describe the new UI; a `BuildContext` is valid only while `mounted` | FPB "Control build() cost", FAPI `BuildContext.mounted` |
| Helper methods returning view fragments (`Widget _buildHeader()`) as in other UI toolkits | A separate widget class, `const` where possible | FAPI `StatefulWidget` "Performance considerations", FPB |
| Overriding `==` on UI objects to skip re-renders (React memo habit) | Do not override `operator ==` on widgets; cache the widget instance or use `const` | FPB "Pitfalls" |
| `new Foo()`, `this.x` everywhere, explicit `= null` (Java) | Omit `new`, `this.` except for shadowing, and null initialisers | ED "DON'T use new", "DON'T use this. except…", "DON'T explicitly initialize variables to null" |
| Catch-all `catch (e)` around everything (checked-exception habit) | `on SpecificException catch (e)`; let `Error` subclasses crash | ED "AVOID catches without on clauses", "DON'T explicitly catch Error…" |
| `IFoo` prefixes, `kConstant` or `SCREAMING_CAPS` constants | `UpperCamelCase` types, `lowerCamelCase` constants | ED "DON'T use prefix letters", "PREFER using lowerCamelCase for constant names" |
| Static-only utility classes (Java) | Top-level functions and constants | ED "AVOID defining a class that contains only static members" |
| Raw `Future.then` chains (JS promise habit) | `async`/`await` | ED "PREFER async/await over using raw futures" |

## 4. Review items

Format: `id` — trigger visible in a diff — what to check — why — source.
One-line items are general knowledge; detail appears only where judgment
or a threshold is involved. A finding names the concrete failure.

### 4.1 Correctness and null safety

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| dart-bang | `!` on a value whose non-null invariant is not stated nearby | Promotion (`if (x != null)`, `if (x case final v?)`), `??`, or a local copy of a field | Runtime cast error with no context | DL null safety "Not-null assertion operator"; ED "CONSIDER type promotion or null-check patterns" |
| dart-late | `late` field read on a path that can run before assignment, or `late` plus a "was it set?" check | Nullable type, constructor initialiser, or initialise at declaration | `LateInitializationError` at runtime | ED "AVOID late variables if you need to check whether they are initialized", "DON'T use late when a constructor initializer list will do" |
| dart-dynamic | New `dynamic`, raw generic types, or `as` casts from `dynamic` (JSON decoding) | Typed models; enable `strict-casts`, `strict-inference`, `strict-raw-types` | Unsound implicit casts fail at runtime | DL type system; ED "AVOID using dynamic unless…"; ANA |
| dart-exhaustive | `switch` over a `sealed` type or enum with a `default`/`_` arm, or `if`/`else if` chains of `is` checks | Exhaustive `switch` expression without the catch-all | A new subtype then fails to compile instead of falling through | DL class modifiers "sealed", patterns |
| dart-flag-soup | `isLoading`, `hasError`, `data` as separate fields of one state | A `sealed` state class (or the state library's async type) with one subtype per case | Impossible combinations become representable | DL class modifiers; FARCH "Use immutable data models" |
| dart-equality | Class used as a map key, in a `Set`, or as state compared by value, with `==` but no `hashCode` (or neither) | Override both, keep the class immutable; records already have structural equality | Lookups and change detection fail | ED "DO override hashCode if you override ==", "AVOID defining custom equality for mutable classes"; DL records "Record equality"; LINT `hash_and_equals` |
| dart-immutable-state | State or model objects with mutable fields changed in place | `final` fields; new instance via `copyWith` | Change notification and equality miss in-place edits | FARCH "Use immutable data models"; ED "PREFER making fields and top-level variables final" |
| dart-unrelated-eq | `==` or `contains` between unrelated types | Fix the type | Always false | LINT `unrelated_type_equality_checks`, `collection_methods_unrelated_type` (core) |
| dart-param-final | `final`/`var` on a non-declaring parameter in code with SDK ≥ 3.13 | Remove it; use the `parameter_assignments` lint to forbid reassignment | Compile error since 3.13 (reserved for primary constructors) | DREL 3.13 "Other changes" |

### 4.2 Errors

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| dart-catch-on | `catch (e)` with no `on` clause outside a top-level boundary | `on FooException catch (e)`; a catch-all must rethrow or report | Hides bugs | ED "AVOID catches without on clauses", "DON'T discard errors from catches without on clauses"; LINT `avoid_catches_without_on_clauses` |
| dart-catch-error | `on Error`, `on TypeError`, `on StateError` | Fix the bug; `Error` means a programming error | Recovery from a bug masks it | ED "DON'T explicitly catch Error or types that implement it"; LINT `avoid_catching_errors` |
| dart-throw-error | `throw` of an `Error` subtype for an expected runtime condition (network, parse) | Throw an `Exception` type for recoverable failures | Callers following the rule above will not catch it | ED "DO throw objects that implement Error only for programmatic errors" |
| dart-rethrow | `throw e;` inside a catch | `rethrow` | Keeps the original stack trace | ED "DO use rethrow to rethrow a caught exception"; LINT `use_rethrow_when_possible` |
| dart-empty-catch | Empty `catch {}` | Handle, report or rethrow | Lost failures | LINT `empty_catches` (core) |
| dart-global-errors | App `main` without `FlutterError.onError` and `PlatformDispatcher.instance.onError` | Set both and forward to the project's reporter; customise `ErrorWidget.builder` if the release-mode grey box is not acceptable | Framework errors and errors outside Flutter callbacks go to different hooks | FERR |
| dart-finally-flow | `return`/`break`/`throw` inside `finally` | Move it out | Discards the in-flight exception | LINT `control_flow_in_finally` (recommended) |

### 4.3 Async and isolates

A finding names the isolate, the awaited operation and the failure (lost
error, use after dispose, dropped frames).

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| dart-unawaited | Call returning `Future` whose result is neither awaited nor passed to `unawaited(...)`, inside an `async` function | `await` it, or wrap in `unawaited()` when fire-and-forget is intended | Errors go uncaught; ordering is lost | LINT `unawaited_futures`; DC futures error handling |
| dart-discarded | `Future`-returning call from a non-async callback (`onPressed: () { save(); }`) | `async` callback with `await`, or `unawaited()` | Same as above; `unawaited_futures` does not see non-async functions | LINT `discarded_futures` |
| dart-context-gap | `BuildContext` (or `Navigator.of(context)`, `ScaffoldMessenger.of(context)`) used after an `await` | `if (!context.mounted) return;` (or `if (!mounted) return;` with `State.context`) right after the gap | Context may be unmounted; navigation or dialogs throw or target the wrong tree | FAPI `BuildContext.mounted`; LINT `use_build_context_synchronously` (flutter_lints) |
| dart-setstate-async | `setState(() async {…})`, or `setState` after an `await`/timer/stream event without a `mounted` check | Do the async work first, then `setState` with only the assignment; check `mounted` | `setState` must not return a Future; calling it after `dispose` throws | FAPI `State.setState` |
| dart-dispose | Controller, `AnimationController`, `StreamSubscription`, `Timer`, `FocusNode`, `ChangeNotifier` listener created in `initState` (or as a field) with no matching release in `dispose` | Release each; re-subscribe in `didUpdateWidget` when the source object changes | Leaks and callbacks into a disposed `State` | FAPI `State.dispose`; LINT `cancel_subscriptions`, `close_sinks` |
| dart-future-in-build | `FutureBuilder(future: fetch())` or `stream: repo.watch()` created inside `build` | Obtain the future/stream in `initState`/`didUpdateWidget`/`didChangeDependencies` and keep it in `State` | Every rebuild restarts the task | FAPI `FutureBuilder` |
| dart-listen-in-build | `.listen(` or `addListener` inside `build` | Subscribe in `initState`, or use a builder widget | One more subscription per rebuild | FAPI `State.dispose` (subscribe in `initState`) |
| dart-async-noop | `async` on a function with no `await` that only returns a value | Drop `async` unless the function must return a `Future` that captures thrown errors | Extra wrapping, misleading signature | ED "DON'T use async when it has no useful effect" |
| dart-completer | `Completer` wrapping a call that already returns a `Future` | Use the future or `async`/`await` | Error paths are easily forgotten | ED "AVOID using Completer directly" |
| dart-isolate-offload | `jsonDecode`, sorting, parsing or crypto over a data-controlled payload on the UI isolate | `Isolate.run` (Dart ≥ 2.19) or `compute`; state the payload size source. On web, `compute` runs on the main thread | Work longer than the frame budget drops frames | FISO; DC isolates |
| dart-isolate-ui | `rootBundle`, widgets, or `dart:ui` calls inside a spawned isolate; plugin calls there without `BackgroundIsolateBinaryMessenger.ensureInitialized` | Keep UI and assets on the main isolate; pass a `RootIsolateToken` for platform channels | Not available in spawned isolates | FISO "No rootBundle access or dart:ui methods", "Using platform plugins in isolates" |
| dart-isolate-message | Sending `Socket`, `ReceivePort`, `Finalizable` or similar native-resource objects, or large mutable graphs repeatedly | Send plain data; use `Isolate.exit` to hand over a large result without a copy | Some types cannot be sent; `SendPort.send` copies mutable data | DC concurrency "Message types", FISO "Message passing between isolates" |

### 4.4 Widget build and rendering performance

Report only on paths that run often (per frame, per scroll, per keystroke,
per rebuild of a named ancestor); a cost in `main()` or a once-per-route
path is out of scope. Tag each finding `static` (holds without
measurement) or `needs-measurement`, and name what a human records:
DevTools Performance view on a physical device in profile mode
(`flutter run --profile`), reading the UI and raster rows separately (FPROF).
Debug-mode and simulator numbers are not evidence (FPROF). Budget: 16 ms
per frame at 60 Hz, split as about 8 ms build and 8 ms raster; under 8 ms
total on 120 Hz devices (FPB "Build and display frames in 16ms"). Never
call a performance claim verified without a before/after profile-mode
measurement of the stated mechanism.

Severity: an unbounded structure (a non-lazy list over data-controlled
content, full-size decodes of an unbounded image set, an unbounded cache)
is the high-severity case; the rest are ordinary findings.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| dart-setstate-scope | `setState` in a screen-level `State` for a value one leaf uses | Move the state into a small widget, or use `ValueListenableBuilder`/`AnimatedBuilder` around the consumer | All descendants rebuild | FPB "Control build() cost"; FAPI `StatefulWidget` "Push the state to the leaves" |
| dart-const | Non-`const` constructor call for static content under a frequently rebuilt parent | Make it `const` (and the widget's constructor `const`). Name the widget and the rebuilding ancestor; on a once-built widget it buys nothing | A `const` instance is reused, so the rebuild walk stops there | FAPI `StatefulWidget` "Use const widgets where possible"; ED "CONSIDER making your constructor const if the class supports it" |
| dart-helper-method | `Widget _buildX()` methods in a rebuilt widget | Extract a widget class | Cannot be `const` or skipped; no element of its own | FAPI `StatefulWidget` "Performance considerations"; FPB |
| dart-build-work | Sorting, filtering, regex, formatting, I/O, or object graphs built in `build` | Compute in the state/view-model layer or cache in `State` | `build` runs on every ancestor rebuild | FPB "Avoid repetitive and costly work in build()" |
| dart-builder-child | `AnimatedBuilder`/`ListenableBuilder` whose `builder` constructs a subtree that does not depend on the animation | Build it once and pass it as `child:` | Otherwise rebuilt every tick | FPB "Pitfalls"; FAPI `AnimatedBuilder` "Performance optimizations" |
| dart-subtree-depth | Conditionally wrapping a child (`cond ? IgnorePointer(child: c) : c`) | Always wrap and toggle the property; or a `GlobalKey`/`KeyedSubtree` on the common part | Changing depth or type rebuilds, lays out and repaints the subtree and loses its state | FAPI `StatefulWidget` "Performance considerations" |
| dart-widget-eq | `operator ==` overridden on a `Widget` | Remove it; cache the instance in a `final` field or use `const` | O(N²) comparisons and slower dispatch everywhere | FPB "Pitfalls" |
| dart-mediaquery | `MediaQuery.of(context)` to read one property | `MediaQuery.sizeOf`, `paddingOf`, etc. | `of` rebuilds on any `MediaQueryData` change | FAPI `MediaQuery` |
| dart-keys | Stateful items in a list or a reordered/inserted collection without keys; `UniqueKey()` created in `build` | `ValueKey(item.id)` with a stable id | Unkeyed: state attaches to the wrong item; a new key every build discards state | FAPI `Key`; LINT `use_key_in_widget_constructors` (constructor parameter only) |
| dart-lazy-list | `Column(children: items.map(...))` in a scroll view, or `ListView(children: [...])`, over data-controlled content | `ListView.builder`/`SliverList`; not a finding for a short, code-bounded list | Builds and keeps every child, visible or not | FPB "Be lazy!", "Pitfalls"; FAPI `ListView` |
| dart-item-extent | Lazy list with fixed-height items and no `itemExtent`/`prototypeItem` | Set one of them | Skips per-child measurement for scroll geometry | FAPI `ListView` |
| dart-shrinkwrap | `shrinkWrap: true` on a list nested in another scroll view | Slivers in one `CustomScrollView` | Shrink-wrapping lays out all content; laziness is lost | FAPI `ScrollView.shrinkWrap` |
| dart-intrinsics | `IntrinsicHeight`/`IntrinsicWidth` in list or grid items | Fixed sizes, or a layout that needs one pass | Extra speculative layout pass, up to O(N²) in depth | FPB "Minimize layout passes caused by intrinsic operations"; FAPI `IntrinsicHeight` |
| dart-opacity | `Opacity` widget, especially animated | `AnimatedOpacity`, `FadeTransition`, `FadeInImage`, or `Image`'s `color`/`opacity` | Paints the child into an offscreen buffer (`saveLayer`) | FPB "Minimize use of opacity and clipping", "Pitfalls"; FAPI `Opacity` |
| dart-savelayer | `ShaderMask`, `ColorFilter`, `Clip.antiAliasWithSaveLayer`, or a `Chip` with disabled color in a frequently repainted area | Avoid or scope it; pre-clip images before animating | Each `saveLayer` allocates an offscreen buffer and switches render targets | FPB "Use saveLayer() thoughtfully" |
| dart-clip | Clipping inside an animation or per list item | Pre-clip the image; `borderRadius` on a decoration where it suffices | Clipping is costly though cheaper than `saveLayer` | FPB "Minimize use of opacity and clipping", "Avoid clipping in an animation" |
| dart-backdrop | `BackdropFilter` over a large area | Wrap in `ClipRect` sized to the region; prefer `ImageFiltered` when only the child needs blurring | Expensive, more so when the filter is non-local | FAPI `BackdropFilter` |
| dart-repaint-boundary | Proposal to add `RepaintBoundary`, or an animating widget inside a large static subtree | Require a repaint argument (what animates, what repaints with it) or a raster measurement; the framework already inserts boundaries in common places | Each boundary creates its own layer; it isolates repaints but is not free | FAPI `RepaintBoundary` |
| dart-image-decode | `Image.network`/`Image.asset`/`Image.file` displayed much smaller than the source, without `cacheWidth`/`cacheHeight` (or `ResizeImage`) | Set the decode size to the displayed size in physical pixels | A 4K image shown at 384×216 needs about 1/100 of the memory when decoded at display size | FAPI `Image` |
| dart-image-cache | Gallery or feed of many large images relying on defaults | State the working set; tune `PaintingBinding.instance.imageCache.maximumSize`/`maximumSizeBytes` | Default LRU holds up to 1000 images and 100 MB | FAPI `ImageCache` |
| dart-string-loop | `+=` on a `String` in a loop | `StringBuffer` | One new string per step | FPB "Use StringBuffer for efficient string building" |
| dart-shader-jank | Shader-warmup, SkSL capture or `--purge-persistent-cache` advice | Name the renderer first: Impeller is the default on iOS (only engine), Android API 29+, and macOS, Linux, Windows as of Flutter 3.47, and compiles shaders at build time; web still uses Skia | The Skia-era advice does nothing on Impeller | FIMP |

### 4.5 State management

Flutter does not prescribe one solution; read which one the project uses
and follow that library's conventions (FSM). The checks below hold for any
of them.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| dart-logic-in-widget | Business rules, data fetching or repository calls inside widget code or callbacks | Move to a view model/state object backed by a repository; widgets keep only show/hide conditions, animation, layout by device size and simple routing | Untestable logic tied to rebuilds | FARCH "Do not put logic in widgets", "Use the repository pattern" |
| dart-ephemeral-vs-app | `setState` for state other screens need, or a global store for one widget's toggle | Choose by scope; both are acceptable where they fit | No universal rule; scope decides | FSM ephemeral vs app state |
| dart-broad-listen | A consumer that watches a whole model and rebuilds a large subtree when one field changes | Narrow the listened value (a selector, `ValueListenableBuilder`, smaller consumer) | Same cost as `dart-setstate-scope` | FPB "Control build() cost" |
| dart-unidirectional | Widgets writing directly into data-layer objects, or the data layer holding UI objects | Events go down to the data layer; state flows up to the UI | Updates from several places race and diverge | FARCH "Use unidirectional data flow" |
| dart-di | Repositories or services constructed inside view models or reached through globals | Inject them (constructor or the project's DI) | Global objects make code error prone and untestable | FARCH "Use dependency injection" |
| dart-no-logic-create-state | Logic or arguments passed in `createState` | Keep `createState` returning a new `State` only | Framework contract | LINT `no_logic_in_create_state` (flutter_lints) |

### 4.6 Platform and lifecycle

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| dart-lifecycle | Pausing/resuming work (camera, timers, sockets) on app background with ad hoc flags | `AppLifecycleListener` (or `WidgetsBindingObserver.didChangeAppLifecycleState`), disposed with its owner | Work continues while the app is hidden | FAPI `AppLifecycleListener` |
| dart-context-store | `BuildContext` saved in a singleton, static, or long-lived service | Pass data or callbacks; read context where it is used | A context is valid only while mounted and never remounts | FAPI `BuildContext.mounted` |
| dart-safe-area | Full-screen content without `SafeArea` or explicit padding from `MediaQuery.paddingOf` | Inset content that must stay visible | OS intrusions (notch, status bar) cover it | FAPI `SafeArea` |
| dart-named-routes | New `Navigator.pushNamed`/`routes:` table in an app that needs deep links | `Router`-based navigation (a declarative routing package) | Named routes are not recommended: a deep link always pushes a new route wherever the user is, and that cannot be customised | FNAV "Using named routes" |
| dart-web-libs | `dart:html`, `dart:js` imports in Flutter code | Conditional imports or `package:web`/`dart:js_interop` behind a platform check | Breaks non-web builds | LINT `avoid_web_libraries_in_flutter` (flutter_lints) |
| dart-security-routing | Secrets in source, sensitive data in plain `SharedPreferences`, cleartext HTTP, deep-link handlers acting on unvalidated input, `print` of tokens | Route to `security-reviewer`; never quote the value | Security lane owns it | House routing |

### 4.7 Accessibility and i18n

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| dart-semantics-label | `Image`/`Icon`/`IconButton`/`GestureDetector` that acts or informs with no `semanticLabel`, `tooltip`, or `Semantics(label:)`; decorative images not excluded | Add a label; `excludeFromSemantics` or `ExcludeSemantics` for decoration | Screen readers announce nothing or noise | FA11Y assistive technologies, accessibility testing (`labeledTapTargetGuideline`); FAPI `Image` |
| dart-tap-target | Custom tappable widget smaller than 48x48 dp (Android) or 44x44 pt (iOS) | Enlarge the hit area | Below platform minimums | FA11Y UI design and styling |
| dart-contrast | New text or control colours | At least 4.5:1 against the background; check with `textContrastGuideline` | Readability | FA11Y |
| dart-text-scale | Fixed heights around text, `textScaler`/`textScaleFactor` overridden to 1, overflow at large font settings | Let layouts grow; test at large OS font sizes | Flutter scales text from the OS setting; fixed boxes clip it | FA11Y UI design and styling |
| dart-a11y-test | New screen or custom control | Widget test with `meetsGuideline(androidTapTargetGuideline)`, `iOSTapTargetGuideline`, `labeledTapTargetGuideline`, `textContrastGuideline` | Cheap automated floor; screen-reader checks still need a person | FA11Y accessibility testing |
| dart-hardcoded-text | User-visible string literals in widgets of a localised app | ARB entries through `flutter_localizations`/`gen-l10n` | Untranslatable | FI18N |
| dart-l10n-concat | Sentences built by concatenating translated fragments or numbers | Placeholders, plurals and selects in the ARB message | Word order and plural rules differ by language | FI18N "Placeholders, plurals, and selects" |
| dart-l10n-format | `toString()` of dates, numbers or currency shown to users | `DateFormat`/`NumberFormat` with the current locale | Locale-specific formats | FI18N |

### 4.8 Naming and readability

One line each; the lint sets catch most when enabled.

| id | Trigger | Check | Source |
|---|---|---|---|
| dart-names | Types not `UpperCamelCase`; members, constants not `lowerCamelCase`; files not `lowercase_with_underscores` | Fix the case | ED Style; LINT `camel_case_types`, `non_constant_identifier_names`, `constant_identifier_names`, `file_names` |
| dart-acronyms | `HTTPClient`, `IOStream` mixed with `HttpClient` | Acronyms longer than two letters capitalised like words (`HttpClient`), two-letter ones upper (`IOStream`) | ED "DO capitalize acronyms and abbreviations longer than two letters like words" |
| dart-imports | `package:` import reaching into another package's `src/`; relative import crossing `lib/` | Use the public library; never cross `lib/` with a relative path. Inside `lib/`, follow the project's choice (Effective Dart prefers relative) | ED "DON'T import libraries that are inside the src directory of another package", "DON'T allow an import path to reach into or out of lib", "PREFER relative import paths"; LINT `implementation_imports`, `avoid_relative_lib_imports` |
| dart-import-order | `dart:`, `package:`, relative imports mixed | `dart:` first, then `package:`, then relative, each sorted | ED Style "Ordering" |
| dart-bool-param | Positional `bool` parameters | Named parameter | ED "AVOID positional boolean parameters" |
| dart-getter-name | `getX()` methods for cheap reads | A getter | ED "AVOID starting a function or method name with get", "DO use getters for operations that conceptually access properties" |
| dart-empty-check | `.length == 0` | `.isEmpty`/`.isNotEmpty` | ED "DON'T use .length to see if a collection is empty"; LINT `prefer_is_empty` |
| dart-foreach | `list.forEach((x) { … })` with a function literal | `for (final x in list)` | ED "AVOID using Iterable.forEach() with a function literal"; LINT `avoid_function_literals_in_foreach_calls` |
| dart-tearoff | `(x) => f(x)` | Tear-off `f` | ED "DON'T create a lambda when a tear-off will do" |
| dart-storing-derived | Field holding a value computable from other fields | Getter | ED "AVOID storing what you can calculate" |
| dart-print | `print` in app code | The project's logger or `dart:developer` `log` | LINT `avoid_print` (flutter_lints) |
| dart-docs | New public API without `///` docs, or block comments as docs | `///` starting with a one-sentence summary | ED Documentation "DO use /// doc comments…", "DO start doc comments with a single-sentence summary" |
| dart-sized-box | `Container` used only for size or whitespace | `SizedBox` | LINT `sized_box_for_whitespace`, `avoid_unnecessary_containers` (flutter_lints) |

### 4.9 Testing

`test-reviewer` owns whether tests protect behaviour; these are Flutter
forms.

| id | Trigger | Check | Source |
|---|---|---|---|
| dart-test-layers | New view model, repository or service without unit tests; new view without a widget test | Unit tests per method for view models, repositories, services; widget tests for views, including routing and DI | FARCH "Testing" |
| dart-test-fakes | Mocks reproducing internal call sequences of repositories | Fakes with input/output behaviour; code written to accept them | FARCH "Make fakes for testing" |
| dart-test-pump | Widget test asserting after an async change without `pump`/`pumpAndSettle`, or `Future.delayed` waits | `pump(duration)` for frame-precise steps, `pumpAndSettle` for animations that end; never real-time waits | FTEST widget testing "Notes about the pump() methods" |
| dart-golden | New golden test, or goldens compared across machines | Generate and compare on one platform and Flutter version (CI); update only with `flutter test --update-goldens` and review the image diff | FAPI `matchesGoldenFile` "Including Fonts" |
| dart-integration-perf | Jank claim with no reproducible number | `integration_test` with `binding.traceAction` converted to a `TimelineSummary`, run in profile mode on a device by a human | FTEST profiling; FPROF |

## 5. Version-gated modern features

Suggest only when the `pubspec.yaml` SDK lower bound is at or above the
row. Latest stable: Dart 3.13 (3.13.5 bundled with Flutter 3.47.7,
2026-10-08) (DREL, FREL).

| Version | Suggest | Old form still right when |
|---|---|---|
| 2.19 | `Isolate.run` for one-off background work instead of `spawn` plus ports | Long-lived workers that exchange many messages keep `Isolate.spawn` and ports |
| 3.0 | Records, patterns, exhaustive `switch` expressions, `if-case`, class modifiers (`sealed`, `final`, `base`, `interface`, `mixin class`) | A `default` arm is right when the switched type is not `sealed` and new cases should be handled generically |
| 3.2 | Private `final` fields promote on null checks and `is` tests; drop local copies made only for promotion | Public fields and getters still do not promote |
| 3.3 | Extension types for zero-cost wrappers (ids, units) | A class when runtime type checks or a real wrapper object is needed (extension types are static only) |
| 3.6 | Digit separators (`1_000_000`) | — |
| 3.7 | Wildcard `_` parameters and locals; new "tall" formatter style (formatter output follows the language version) | — |
| 3.8 | Null-aware collection elements (`[?x]`, `{?k: v}`) | — |
| 3.9 | Flow analysis assumes null safety (more accurate promotion; more `dead_code` warnings) | — |
| 3.10 | Dot shorthands (`.center`, `.new()`) where the context type is known | Where the type is not obvious from context, the full name reads better |
| 3.12 | Private named parameters (`{required this._x}`) instead of initializer lists that only strip `_` | — |
| 3.13 | Primary constructors (`class Point(var int x, var int y);`), `new`/`factory` constructors without repeating the class name; `List.unmodifiableOf`, `Future.pause` | Classes with complex initialisation stay readable with a normal constructor; libraries whose users are on older SDKs |

Not available: macros (work stopped January 2025; use `build_runner`
code generation) (DMAC). Dart 3.14 and 3.15 (type promotion of `this`)
are unreleased; do not suggest them. Never suggest experiment flags as
fixes.

Flutter stable 3.47: Impeller default on every native platform; Skia on web
(FIMP).

## 6. Concurrency model

- Every isolate has its own memory, its own globals and one thread running
  an event loop that processes events one at a time; `Future`, `Stream`
  and `async`/`await` schedule work on that loop (DC concurrency "Event
  Loop").
- Synchronous code is not preempted: a long computation in any callback
  blocks that isolate. On the Flutter main isolate that means missed
  frames (DC; FISO).
- Isolates communicate only by message passing. `SendPort.send` copies
  mutable data; `Isolate.exit` transfers the result without a copy;
  some native-resource types cannot be sent (DC "Message types"; FISO).
- No shared state means no data races and no need for locks, but race
  conditions remain: two `async` operations on one isolate can interleave
  at `await` points and act on stale reads (DC "Isolates").
- `Isolate.run` and `compute` for one-off work; spawned isolates have no
  widgets, no `dart:ui`, no `rootBundle`; platform channels need
  `BackgroundIsolateBinaryMessenger` (FISO).
- Web has no isolates: `compute` runs on the main thread, and web workers
  are the separate mechanism (FISO "Web platforms and compute"; DC
  "Concurrency on the web").
- Two threads per frame: the UI thread runs Dart build and layout, the
  raster thread draws. A long UI frame is Dart work; a long raster frame is
  painting, layers and shaders. Attribute a jank claim to one of them
  (FPROF).
- Correctness vs speed: a use-after-dispose, a lost error or a stale read
  belongs in 4.3; dropped frames in 4.4.

## 7. Linter mapping

Run the project's own checks first (`lefthook.yml`,
`.pre-commit-config.yaml`, CI results via `gh pr checks`) and pass their
output to the review; never report "no issues" from a tool that did not
run. `dart analyze` (or `flutter analyze`) and `dart format
--output=none --set-exit-if-changed <files>` read sources without running
project code, but need resolved packages; when `pub get` has not run, name
the commands for a human or read CI output. Do not restate findings a tool
that ran already reported.

Lint sets, as published: `package:lints` 6.1.0 `core` and `recommended`,
and `package:flutter_lints` 6.0.0 (`recommended` plus ten Flutter rules).
`flutter_lints` 5.0 removed `prefer_const_constructors`,
`prefer_const_declarations` and `prefer_const_literals_to_create_immutables`,
so `const` use is not linted unless the project adds them (LINT).

| Item | Caught by | In the default sets? |
|---|---|---|
| dart-dynamic | `strict-casts`, `strict-inference`, `strict-raw-types` analyzer modes | No; project opt-in |
| dart-exhaustive | Compiler (exhaustiveness on `sealed`/enum); `exhaustive_cases` for enum-like classes | Compiler; `exhaustive_cases` recommended |
| dart-equality | `hash_and_equals` | core |
| dart-unrelated-eq | `unrelated_type_equality_checks`, `collection_methods_unrelated_type` | core |
| dart-catch-on, dart-catch-error | `avoid_catches_without_on_clauses`, `avoid_catching_errors` | No |
| dart-rethrow | `use_rethrow_when_possible` | recommended |
| dart-empty-catch | `empty_catches` | core |
| dart-finally-flow | `control_flow_in_finally` | recommended |
| dart-unawaited, dart-discarded | `unawaited_futures`, `discarded_futures` | No |
| dart-context-gap | `use_build_context_synchronously` | flutter_lints |
| dart-dispose (subscriptions, sinks) | `cancel_subscriptions`, `close_sinks` | No |
| dart-const | `prefer_const_constructors`, `prefer_const_declarations`, `prefer_const_literals_to_create_immutables`; `prefer_const_constructors_in_immutables` | Only the last, in flutter_lints |
| dart-keys | `use_key_in_widget_constructors` (public widget constructors take a `key`) | flutter_lints |
| dart-no-logic-create-state | `no_logic_in_create_state` | flutter_lints |
| dart-web-libs | `avoid_web_libraries_in_flutter` | flutter_lints |
| dart-print | `avoid_print` | flutter_lints |
| dart-sized-box | `sized_box_for_whitespace`, `avoid_unnecessary_containers` | flutter_lints |
| dart-names | `camel_case_types`, `camel_case_extensions`, `non_constant_identifier_names`, `constant_identifier_names`, `file_names` | core / recommended |
| dart-imports | `implementation_imports`, `avoid_relative_lib_imports`, `depend_on_referenced_packages` | recommended / core |
| dart-empty-check | `prefer_is_empty`, `prefer_is_not_empty` | core |
| dart-foreach | `avoid_function_literals_in_foreach_calls` | recommended |
| Effective Dart usage forms (`new`, `this.`, null init, interpolation, collection literals, initializing formals, super parameters) | `unnecessary_new`, `unnecessary_this`, `avoid_init_to_null`, `prefer_interpolation_to_compose_strings`, `prefer_collection_literals`, `prefer_initializing_formals`, `use_super_parameters` | recommended |
| formatting, line length, trailing commas | `dart format` (80 columns unless `formatter: page_width` is set) | Tool |
| dart-param-final | Compiler (SDK ≥ 3.13); `parameter_assignments` for the intent | Compiler; lint opt-in |

No tool decides: rebuild scope and frequency, whether a list is
data-controlled, image display size versus decode size, which thread a
jank frame belongs to, whether the renderer makes a shader finding moot,
logic placement between widget and view model, race conditions across
`await`, or whether a version gate applies. Those are the review's work.
