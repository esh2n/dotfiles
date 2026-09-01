---
paths:
  - "**/*.css"
  - "**/*.scss"
  - "**/*.sass"
  - "**/*.less"
  - "**/*.html"
  - "**/*.htm"
---
# Web Hooks

> This file extends [common/hooks.md](../common/hooks.md) with CSS/HTML
> specific content.

Implemented in `packs/web/hooks/`, registered by `packs/web/settings.layer.json`
(only present in the merged `~/.claude/settings.json` while the `web` pack is
enabled — `yoki-switch pack enable web`).

## PostToolUse — `web-css-lint-post-edit.js` (profile: standard)

Runs after `Edit` / `Write` / `MultiEdit` on:

- `.css` / `.scss` / `.sass` / `.less` → `stylelint`
- `.html` / `.htm` → `html-validate`

`.vue` / `.svelte` / `.astro` are deliberately **not** matched — those are
component-framework files whose style/markup blocks are governed by the
framework's own tooling, not a bare stylesheet linter run against the whole
file.

### Project config or nothing

This hook never lints against an imposed config. It walks up from the
edited file's directory looking for a project-owned config:

- stylelint: `.stylelintrc`, `.stylelintrc.{json,yaml,yml,js,cjs,mjs}`,
  `stylelint.config.{js,cjs,mjs}`, or a `"stylelint"` key in `package.json`
- html-validate: `.htmlvalidate.{json,js,cjs}`

If none of these exist, the project has not opted into CSS/HTML linting on
edit, and this hook does nothing — the reviewer agents (`web-reviewer` etc.)
still apply the universal review layer regardless; this hook only adds
deterministic, config-driven linting on top when a project has set one up.
Never falling back to a config this pack ships itself is intentional: a
stylelint/html-validate config encodes project-specific rules (naming
convention, allowed properties, a11y strictness) that only the project can
own.

- At the `standard` profile: no config found → silent, zero exec calls.
- At the `strict` profile: no config found → exactly one hint line per
  session (marker file in `os.tmpdir()`) suggesting a config be added.

### Binary resolution

When a config is found, the linter binary is resolved preferring the
project's own `node_modules/.bin/<tool>` — walked up from the config
directory, so hoisted-workspace layouts still resolve — over a bare name on
`PATH`. If neither exists, this prints at most one hint line per session
(separate marker from the "no config" hint) and exits 0.

### Output

Output is filtered to lines that mention the edited file (same technique as
`go-guard-post-edit.js`), capped at 10 lines, and printed to stderr with a
`[web-guard]` prefix — **only when there is something to report** (0
findings = 0 extra tokens). It never blocks the edit and never exits
non-zero. Each linter run is capped at 30s; an overrun is killed and treated
as fail-open (no crash, nothing reported).

## Disabling

- Per project: add `post:web-guard:post-edit` to `.yoki.json`'s
  `disabledHooks`, or set `hookProfile` below `standard`.
- Machine-wide: `yoki-switch pack disable web` removes the hook script and
  its registration entirely.

## Why this hook doesn't go through `run-with-flags.js`

Same reason as `go-guard-post-edit.js` — see
`packs/go/rules/golang/hooks.md`, "Why these hooks don't go through
run-with-flags.js". Pack-owned hooks live in `packs/<name>/hooks/` and are
merged (symlinked) into `~/.claude/hooks/` by `yoki-switch`'s `MERGE_DIRS`,
which is outside `runtime/yoki` — the directory `run-with-flags.js`'s
`CLAUDE_PLUGIN_ROOT` path-traversal guard resolves everything against. So
`run-with-flags.js` can never load a pack hook directly. Instead this hook
is registered as a direct `node ...` command in
`packs/web/settings.layer.json` and performs its own profile gating by
requiring `runtime/yoki/scripts/lib/hook-flags.js` directly (via
`$YOKI_ROOT`, which is always set) — the exact module `run-with-flags.js`
itself uses, so gating behavior (profile precedence, `.yoki.json`,
`YOKI_DISABLED_HOOKS`) is identical either way.

## Recommended stylelint rules (not imposed)

This hook never applies these itself — it only runs whatever config a
project already has (see "Project config or nothing" above). If a project
wants stronger cascade/browser-support enforcement than its own config gives
it, these are the rules worth adding, with the trap each one closes:

- `declaration-block-no-shorthand-property-overrides` — catches a shorthand
  silently resetting a longhand written earlier in the *same* declaration
  block (e.g. `font:` after `font-weight:`).
- `declaration-block-no-redundant-longhand-properties` — flags all-longhand
  declarations that could collapse into one shorthand, the inverse trap.
- `shorthand-property-no-redundant-values` — flags edge-count shorthand
  values that repeat what a shorter form would already express (e.g.
  `margin: 1px 1px 1px 1px` instead of `margin: 1px`).
- `no-descending-specificity` — flags a selector with lower specificity
  appearing after one with higher specificity that matches the same
  elements, the classic silent-override setup.
- `selector-max-id` (`0`) — bans ID selectors in stylesheets, removing the
  most common source of specificity escalation.
- `selector-max-specificity` (e.g. `"0,3,0"`) — caps specificity outright so
  cascade fights get resolved with `@layer`/`:where()` instead of another
  escalation.
- `selector-pseudo-class-no-unknown` — catches a typo'd or unsupported
  pseudo-class before it silently invalidates a selector list.
- `declaration-property-value-no-unknown` — catches a property/value pair
  that doesn't parse, before it silently no-ops in the browser.
- `declaration-no-important` — bans `!important` outright, forcing cascade
  fights through layers/specificity instead.
- `plugin/no-unsupported-browser-features`
  (`stylelint-no-unsupported-browser-features`, reads `browserslist`) —
  flags syntax the project's own declared browser matrix doesn't support.
- `stylelint-value-no-unknown-custom-properties` — flags `var(--x)` where
  `--x` is never defined anywhere in scope, the static half of the
  "undefined custom property" Defensive CSS intent (see `skill:
  defensive-css`).
- `declaration-property-unit-disallowed-list` with `{ "font-size": ["px"],
  "line-height": ["px", "em"] }` — closes the fixed-root-font and
  inherited-line-height traps (see `skill: css-units`).
- `unit-disallowed-list` with `["vh"]` as a warning-level suggestion for
  mobile-facing projects, pointing to `svh`/`dvh` instead.

## Tools

- `stylelint`, `html-validate`: not installed by this pack — they are
  resolved from the project's own `node_modules` (or `PATH`) precisely
  because the config that governs them is project-owned, not
  machine-owned. Nothing is installed globally on their behalf.
