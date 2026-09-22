---
question: "What is the smallest, zero-live-write first increment for wiring jig's already-built compose/permissions/mcp domain logic into an actual jig apply --target claude CLI command?"
date: 2026-09-21
verdict: "jig already has all the pure domain logic needed to compose a Claude Code settings.json (layer selection, settings merge, permissions, MCP) but nothing wires it to a CLI; the smallest safe increment is a dry-run-only jig apply --target claude that reuses existing functions verbatim and diffs against yoki-switch's own fixture-tree golden test, with no writer, no symlink handling, and no codex/omp support in this first pass."
unverified:
  - "whether any real (non-fixture) settings.layer.json or personal file currently uses the {{DOTFILES_PARENT}} template variable — not yet grepped"
  - "whether key/array ordering diverges between jq's merge and jig's mergeObjects/dedupeEntries, producing diff noise rather than a real bug — unverified until a real run against the fixture tree or a captured live settings.json"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# install pipeline — smallest safe first increment

Builds directly on `.tmp-research/yoki-jig-coverage.md` §2 (already establishes
"built, not wired" for compose/permissions/mcp). This doc narrows that finding
into one concrete, zero-live-write increment.

## 1. Capability table

| compose concern | jig port exists? | wired to a CLI? | yoki-switch does it? where | gap |
|---|---|---|---|---|
| layer selection (core+packs+personal, alphabetical packs, skipped-pack warn) | `domain/compose/layers.ts::selectLayers` | no | `yoki-switch::enabled_packs` + inline pack loop | none functionally; jig has no reader for `~/.claude/.claude-packs` yet (trivial) |
| generic settings merge (jq `*` semantics, arrays replaced not concatenated) | `domain/compose/merge.ts::mergeJson/mergeLayers` | via `compose.ts` only | `yoki-switch::merge_settings` jq `$layer * $packsMerged * $personal` | none — verified same semantics (object recurse, else right-wins) |
| hooks re-derivation (union event keys, concat personal→packs→core) | `domain/compose/hooks.ts::mergeHooks` | via `compose.ts` only | `merge_settings` jq hooks block (lines 291-296) | none — order and precedence match exactly |
| env / enabledPlugins / extraKnownMarketplaces (shallow merge) | `domain/compose/compose.ts::composeSettings` | via `compose.ts` only | `merge_settings` jq `+` lines 298-302 | none |
| permissions.yaml parse (allow/deny/guardFloor/defaultMode) | `domain/permissions/parse.ts::parseYamlPermissions` | no | `lib/permissions/to-claude.js` (node, called by `merge_settings`) | none — hand-ported, same hand-rolled subset grammar |
| permissions layer merge (dedupe by pattern, union enforce, last-defaultMode-wins) | `domain/permissions/merge.ts::mergePermissionLayers` | no | same `to-claude.js` | none |
| permissions → Claude settings shape | `domain/permissions/to-claude.ts::toClaudeSettings` | no | same | none |
| hook-enforced deny sidecar (`.yoki/permissions.json`) | `hookEnforcedDeny()` exists but **nothing writes the file** | no | `merge_settings` line 312-313 (`$CLAUDE_DIR/.yoki/permissions.json`) | jig computes the data, has no writer — **do not need this for the first increment** (compare only `settings.json`) |
| mcp.json parse + secret-literal guard | `domain/mcp/parse.ts` | no | `lib/mcp-inventory/source.js` | none |
| mcp layer merge (by-name replace, first-seen order) | `domain/mcp/merge.ts::mergeMcpLayers` | no | same source.js `mergeLayers` | none |
| mcp → Claude `mcpServers` | `domain/mcp/to-claude.ts::buildClaudeMcpServers` | no | `lib/mcp-inventory/writers/claude.js` | none |
| mcp → **codex** / **omp** `mcpServers` | **none** — only `to-claude.ts` exists | n/a | `lib/mcp-inventory/writers/{codex,omp}.js` | real gap, but out of scope for increment 1 (claude-only) |
| permissions → **codex** / **omp** | **none** | n/a | `lib/targets/{codex,omp}.js` via `to-codex.js`/`to-omp.js` (referenced in coverage doc) | real gap, out of scope for increment 1 |
| `{{HOME}}`/`{{DOTFILES_ROOT}}`/`{{USER}}` template substitution | `domain/compose/template.ts::applyTemplate` (generic `{{VAR}}`) | no | `merge_settings` runs 3 fixed `sed` passes AFTER the jq merge (lines 304-306); also `{{DOTFILES_PARENT}}` which jig's template.ts has no equivalent constant for | jig's version is generic (any var map) — fine, but the CALLER must supply `{HOME, DOTFILES_ROOT, USER, DOTFILES_PARENT}` explicitly; nothing in jig resolves `DOTFILES_PARENT` today |
| `.autoMode` carry-over from previous settings.json | **not implemented anywhere in jig** | n/a | `merge_settings` lines 315-326 (jq `+ {autoMode: $prev.autoMode}`) | explicitly named as deferred in `install-profile.ts`'s own comment — a **live-write-time** concern, irrelevant to a dry-run diff (a diff should EXCLUDE `.autoMode` or seed it from the live file, see §4) |
| full `installProfile` use-case (select→compose→write to N targets) | `app/install/install-profile.ts::installProfile` | **no CLI command calls it** (confirmed: `grep installProfile` outside its own file/test = 0 hits) | equivalent is `yoki-switch apply`'s pipeline | this is the exact gap in the task title |
| symlink/merge-dir machinery (`skills,hooks,scripts,commands,agents,rules,workflows`) | none | n/a | `yoki-switch::merge_dir` | correctly out of scope, not touched |
| dry-run/diff/provenance pattern (reusable) | `domain/tiers/diff.ts::unifiedDiff` (dependency-free LCS unified diff) + `app/apply/ports.ts::ApplyPorts` (`readFile→undefined-safe`, `sha256`, manifest, provenance) + `cli/apply.ts` CLI-arg/report shape | wired, but **only for `jig apply` (pi/dsh/litellm tier files)** | `yoki-switch apply --dry-run` (claude target, lines 472-625: builds against a throwaway `CLAUDE_DIR`, diffs) | this is the pattern to clone for settings.json — see §3 |

## 2. Can jig already compose a full settings.json from the same source files?

**Yes, functionally — for the Claude target only.** Every domain function needed
(`selectLayers`, `mergeJson`/`mergeHooks` via `composeSettings`, `parseYamlPermissions`
+ `mergePermissionLayers` + `toClaudeSettings`, `parseMcpLayer` + `mergeMcpLayers` +
`buildClaudeMcpServers`) reads the identical source files yoki-switch reads
(`core/settings.layer.json`, `packs/<name>/settings.layer.json`,
`personal/settings.personal.json`, `{core,packs/<name>,personal}/permissions.yaml`,
`{core,packs/<name>,personal}/mcp.json`), is unit-tested, and its own test
(`test/app/install/install-profile.test.ts`) proves `installProfile` composes once
and can fan out to multiple `TargetWriter`s (a `claude` fake and a `codex` fake are
both used in the test, though only `ClaudeTargetWriter` actually exists in `infra/`).

What's missing to go from "the pure functions exist" to "one CLI command produces
a settings.json comparable to yoki-switch's":
1. **No file-reading glue** — nothing in `app/` reads `.claude-packs` to build the
   `enabled` list, reads the 3N permissions.yaml/mcp.json files, or feeds them
   through parse→merge in the right order. This is thin plumbing (`FileSystem.read`
   already exists as a port), not new domain logic.
2. **No template-var resolution** — `applyTemplate` is generic; something has to
   supply `{HOME, DOTFILES_ROOT, USER}` (present) and `DOTFILES_PARENT` (absent —
   needs adding, one `dirname(DOTFILES_ROOT)` call, mirroring `yoki-switch:272`).
3. **`.yoki/permissions.json` sidecar** is computed (`hookEnforcedDeny`) but has no
   writer anywhere in `infra/` — irrelevant for a dry-run diff of `settings.json`
   itself, relevant only once this becomes a real `--write` path.
4. **No codex/omp writers or codex/omp permission+mcp compilers** — confirmed by
   grep, zero `to-codex.ts`/`to-omp.ts` files exist anywhere under
   `domain/{permissions,mcp}/`. Increment 1 must be Claude-only.

## 3. Proposed first increment — concrete

**Add `jig apply --target claude` (extending the existing `jig apply` subcommand,
not `jig install`)**, dry-run only, no `--write` support yet (refuse `--write` for
claude the same way litellm already refuses it in `applyLitellm` — reuse that
exact refusal pattern). Rationale for extending `apply` rather than adding
`install`: `apply` already owns the dry-run/diff/report vocabulary users expect
from `jig`; `install-profile.ts`'s own doc comment says it is staged ahead of
"`install` / `apply --target claude`" — so this is the second of those two named
options, and it is the smaller one (no writer, no symlinks).

Concrete wiring, reusing existing functions verbatim:

1. New `app/apply/apply-claude.ts` (sibling to `apply-tiers.ts`), exposing
   `applyClaudeSettings(paths, ports): Promise<TargetResult>` (same `TargetResult`
   shape `apply-tiers.ts` already exports — outcome/diff/dropped/wrote/message —
   so `cli/apply.ts`'s existing `formatResult` needs no changes).
2. Inside it: read `.claude-packs` (new tiny parser, ~10 lines, same
   `grep -vE '^\s*(#|$)'`+sort-unique semantics as `yoki-switch::enabled_packs`) →
   build `LayerSelectionInput.enabled`; read the N settings.layer.json /
   permissions.yaml / mcp.json files via `ports.readFile` (already exists on
   `ApplyPorts`, already `undefined`-safe for a missing file — matches
   `parseYamlPermissions("")`'s and `EMPTY_MCP_LAYER`'s "missing file = empty
   layer" contract).
3. Call, in order: `parseYamlPermissions` × N → `mergePermissionLayers` →
   `toClaudeSettings`; `parseMcpLayer` × N → `mergeMcpLayers` →
   `buildClaudeMcpServers`; `selectLayers` on the parsed settings.layer.json
   objects; `composeSettings({...selection, permissions, mcpServers})`;
   `applyTemplate(composed, {HOME, DOTFILES_ROOT, USER, DOTFILES_PARENT})`.
4. Read the live (or a target) `settings.json` via `ports.readFile`, drop (or
   normalize) the `.autoMode` key from BOTH sides before comparing (this key is
   Claude-Code-runtime-owned and out of scope — normalizing it out, not carrying
   it over, is correct for a read-only diff), then `unifiedDiff(destPath,
   current ?? "", "generated", JSON.stringify(generated, null, 2) + "\n")` —
   identical call shape to `applyPi`/`applyDsh` in `apply-tiers.ts`.
5. `cli/apply.ts::parseArgs` already accepts `--target`; only needs `"claude"`
   added to a claude-aware target union (today `ApplyTarget` is `"pi"|"dsh"|
   "litellm"` — widen it, or keep `apply-claude` on a parallel small CLI switch
   inside `applyCli` so the pi/dsh/litellm union stays untouched. Prefer the
   latter for increment 1: touch the smallest surface, since `ApplyTarget`
   widening ripples into `ALL_APPLY_TARGETS`/`applyTiers`'s loop and litellm's
   special-case refusal logic that has nothing to do with claude).

**What makes the diff byte/semantically comparable:** yoki-switch's actual
`settings.json` is a straight `JSON.stringify(obj, null, 2)`-equivalent (jq's `.`
pretty-print, 2-space indent) — same as jig's existing `ClaudeTargetWriter`
(`JSON.stringify(profile.settings, null, 2)` + trailing `\n`). Key ORDER may
differ (jq preserves the `$layer * $packsMerged * $personal` object's insertion
order; jig's `mergeObjects` does `Object.entries` insertion order the same way)
— this should match in practice since both start from the same core file and
apply the same key-rewrite sequence, but it is unverified and is exactly what
the dry-run diff is FOR: if the diff is non-empty only on `deny`/`allow` array
ORDER or object KEY order (not content), semantically-comparable diffing
(structural JSON diff sorting object keys and content-set-comparing the deny/
allow arrays) may be needed as a fallback — start with `unifiedDiff` on the
pretty-printed text and only add structural comparison if the first real run
shows order noise.

**How to verify parity mechanically, today, without writing this yet:**
`core/validation/test-merge-settings.sh` and `test-targets-golden.sh` already
build a **synthetic fixture tree** (`core/validation/fixtures/targets/{core,
personal}/{settings.layer.json,permissions.yaml,CLAUDE.layer.md,...}`) and run
`yoki-switch` against it via `CLAUDE_DIR`/`DOTFILES_ROOT` env overrides, asserting
merge semantics (personal-wins, hook order, permission union) — this is a
ready-made golden target. The first increment's verification path: point
`jig apply --target claude` (once it exists) at the SAME fixture tree
(`JIG_APPLY_ROOT` or equivalent override, mirroring how `resolveApplyRoot()`
already supports `JIG_APPLY_ROOT` for tests), run yoki-switch's
`merge_settings` against that fixture too, and diff jig's generated
`settings.json` against yoki-switch's — zero live files touched either side.

## 4. Risks / unknowns / do-not-touch

- **Do not touch**: `~/.claude/settings.json` (live), any `MERGE_DIRS` symlink
  target (`skills,hooks,scripts,commands,agents,rules,workflows`), `.yoki/
  permissions.json`, `.claude-packs` (read-only in this increment), `.autoMode`
  (normalize out of the diff, never write it).
- **Top parity risk**: key/array ordering divergence between jq's merge and
  jig's `mergeObjects`/`dedupeEntries` producing a non-empty diff that is noise,
  not a real bug — this needs one real run against the fixture tree (or a
  captured real `settings.json`) before trusting the diff output as a parity
  signal. Second-order risk: the `DOTFILES_PARENT` template var yoki-switch
  substitutes that jig's `template.ts` caller doesn't yet supply anywhere —
  if any layer file actually uses `{{DOTFILES_PARENT}}`, the diff will show a
  literal unsubstituted token until the CLI glue passes it in.
- **Unknown**: whether any settings.layer.json/personal file currently commits
  a real (not test-fixture) `{{DOTFILES_PARENT}}` usage — grep before wiring so
  the var list is complete, not discovered via a failing diff.
- **Scope discipline**: this increment produces zero new writers (`--write`
  stays refused for claude, same message pattern as litellm's `"deferred:
  measurement plane, apply manually after review"` refusal), touches no
  symlink code, and adds no codex/omp compilers — those are each their own
  follow-on increment once this one's diff is proven clean against the fixture
  and (ideally) a real machine's `settings.json`.
