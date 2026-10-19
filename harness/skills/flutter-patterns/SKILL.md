---
name: flutter-patterns
description: Use when writing or reviewing Dart or Flutter code — null safety and `!`/`late`, sealed classes and exhaustive switch, records and patterns, `BuildContext` used after `await`, `setState` after dispose, missing `dispose()`, unawaited futures, isolates and `Isolate.run`, widget rebuild scope, `const` widgets, keys, lazy lists, `Opacity`/`saveLayer` cost, image decode size, state management placement, accessibility (semantics labels, tap targets, text scaling), localisation, widget and golden tests, or a Dart 3.x version-gated feature (dot shorthands, primary constructors). Covers Effective Dart, Flutter performance guidance, the isolate concurrency model, and what `dart analyze`, `flutter_lints` and `dart format` already catch.
metadata:
  namespaces: [lang/dart]
  verified: 2026-10
---

# Flutter and Dart patterns

Writing or reviewing Dart or Flutter: read `references/review-standard.md`
first — the single Dart/Flutter review standard (items with sources,
version gates, the isolate concurrency model, linter mapping) shared by
the writer and `code-reviewer`.

## Rules of thumb

- Read `pubspec.yaml` (SDK lower bound, Flutter constraint) and
  `analysis_options.yaml` before suggesting a feature or a lint fix.
- Never run `flutter`, `dart run` or `build_runner` on an untrusted diff;
  they execute build scripts and generators.
- Model alternatives with `sealed` classes and exhaustive `switch`;
  avoid `!` and `late` where promotion or initialisation works.
- After every `await` in widget code, check `mounted` before touching
  `context` or calling `setState`; release in `dispose()` what
  `initState` created.
- Keep logic in view models and repositories; widgets describe UI from
  state.
- A performance finding names the thread (UI or raster), the trigger and
  its frequency; only a profile-mode run on a physical device verifies it.

## Related

- `clean-architecture` — layer boundaries and dependency direction
- `ui-ux-pro-max` — visual design for Flutter screens
- `tdd-workflow` — test-first loop
