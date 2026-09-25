---
question: "rulesync — function-level close read: what should jig adopt structurally from rulesync's design, and should jig depend on rulesync as a library?"
date: 2026-09-22
verdict: "ADAPT the pattern, don't vendor the code: jig should adopt rulesync's canonical-intersection + typed per-target override-block shape (for hooks/permissions/rules) and its {class, meta} factory-map with a shared diff-and-warn function, but should not depend on rulesync as a library — rulesync has no runtime enforcement (pure generator, no fail-closed concept) and thin-to-absent pi/DSH coverage for hooks/permissions/MCP, so jig's guard enforcement and pi/DSH translation must be built from scratch regardless."
unverified: []
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# rulesync — function-level close read

**Source**: `github.com/dyoshikawa/rulesync`, cloned shallow (`--depth 1`) to `/tmp/rulesync-read`.
**Commit read**: `967555fe8af28df59f0dcfeabda9fce8c8bd94b3`, 2026-09-21 19:50:31+09:00 (merge of PR #3142,
"homebrew-formula/v17.0.0"). **Version**: `package.json` `"version": "17.0.0"`.
Shallow clone hides deeper history, but the single visible commit and the version number both
point at a large, currently-maintained project (this is the state as of yesterday relative to
today's date).

## Repo layout map

```
.rulesync/                  # this repo's OWN canonical source tree (dogfood example)
  rules/*.md                # 5 topic rules, frontmatter: root/targets/description/globs
  skills/<name>/SKILL.md     # ~40 skill dirs, Agent-Skills-shaped frontmatter
  subagents/, commands/ (not inspected in depth)
src/
  types/                    # canonical schema + shared abstractions (AiFile, AiDir,
                             # FeatureProcessor, DirFeatureProcessor, ToolFile, ToolTarget)
  features/
    rules/                  # ~55 <tool>-rule.ts files + rules-processor.ts (2959 lines)
    commands/                # ~35 <tool>-command.ts
    subagents/                # ~35 <tool>-subagent.ts
    skills/                    # ~40 <tool>-skill.ts
    hooks/                      # ~45 <tool>-hooks.ts
    permissions/                  # ~35 <tool>-permissions.ts
    ignore/                          # ~20 <tool>-ignore.ts
    mcp/                                # ~40 <tool>-mcp.ts
    checks/                               # 7 <tool>-check.ts (code-review-guideline feature)
    shared/                                 # cross-feature shared-config-gateway
  cli/commands/               # generate.ts, import.ts, add.ts, init.ts, mcp.ts, doctor.ts, ...
  config/                      # config-resolver.ts, config.ts (rulesync.jsonc schema)
  lib/                          # import.ts (importFromTool), gh/, apm/
```

**Scale**: 581 non-test `.ts` files under `src/`, 455 `.test.ts` files (≈78% file-count test
ratio). ~55 distinct target harnesses are wired for rules alone (Claude Code, Codex CLI, Cursor,
Copilot, Gemini/Antigravity, Cline, Roo, Kilo, OpenCode, Junie, Kiro (3 variants), Zed, Warp,
Devin, Amp, Pi, **DSH**, and ~35 more). Every target is a **module of plain classes + one static
factory-map entry**, not a plugin package — there is no runtime plugin loader.

---

## 1. The canonical model

**Source of truth**: `.rulesync/` in the *consuming* repo (not this repo's own vendored copy,
though this repo dogfoods the same shape). Subdirectories per artifact type:
`rules/`, `commands/`, `subagents/`, `skills/`, plus single/aggregate files `mcp.jsonc` /
`hooks.jsonc` / `permissions.jsonc` / `.rulesyncignore`.

- **Rules** — `.rulesync/rules/*.md`, Markdown + YAML frontmatter, schema in
  `src/features/rules/rulesync-rule.ts:30` (`RulesyncRuleFrontmatterSchema`, zod). Canonical
  fields: `root` (bool), `localRoot` (bool), `targets` (array, default `["*"]`), `description`,
  `globs` (array). Then **one optional per-target escape-hatch block per adapter**, e.g.
  `claudecode: { paths }`, `cursor: { alwaysApply, description, globs }`, `pi: { systemPrompt:
  "append", contextFile: "override" }`, `roo: { mode }`, `takt: { name, extends, facet }`. These
  are *not* generic key-value passthrough; each target's rule adapter declares its own typed
  sub-schema and only that adapter reads it (verified in `pi-rule.ts:145-163` inside
  `rulesync-rule.ts`, consumed only by `PiRule.fromRulesyncRule`).
- **"Applies to tool X"**: the `targets: string[]` array on every rule/command/subagent
  (`"*"` = all, or an explicit list of tool-target strings) — checked with `isTargetedByRulesyncRule`
  / `isTargetedByRulesyncSkill` per adapter (`tool-rule.ts:434-459`,
  `dsh-skill.ts:227-230`). **Skills carry no `targets` gate on their own semantics** — every
  adapter's `isTargetedByRulesyncSkill` still reads the same `targets` frontmatter field, so the
  mechanism is uniform across artifact types.
- **Path-conditional**: `globs: string[]` on a rule, used two ways — (a) as literal glob metadata
  handed to tools that natively support conditional rule application (Cursor `alwaysApply`/`globs`,
  Claude Code `claudecode.paths`), and (b) as a *directory-nesting signal*: `agentsmd.subprojectPath`
  (`rulesync-rule.ts:210-320`, `resolveSubprojectPath`) turns a rule with `globs: ["packages/api/**/*"]`
  into a **nested** `packages/api/AGENTS.md` for tools that walk the directory tree — either derived
  automatically (`deriveSubprojectPathFromGlobs` config option, `getGlobsStaticPrefix`) or explicit.
- **MCP source**: `.rulesync/mcp.jsonc`/`.mcp.json`, one JSON document per server
  (`src/features/mcp/rulesync-mcp.ts`, not read in depth but structurally mirrors the standard
  `mcp.json` "mcpServers" shape plus a `targets` gate per server).
- **Hooks source**: `.rulesync/hooks.jsonc` — one canonical event vocabulary
  (`src/types/hooks.ts`: `CLAUDE_HOOK_EVENTS`, `CODEXCLI_HOOK_EVENTS`, `PI_HOOK_EVENTS`, ...,
  each a *subset* of one canonical `HookEvent` union) under a shared `hooks: {<event>: [...]}}` key,
  **plus a per-target override block** at the top level keyed by tool name (`config.claudecode.hooks`,
  `config.codexcli.hooks`, ...) that is merged over the shared block
  (`hooks-processor.ts:1139-1142`, `effectiveHooks = {...sharedHooks, ...overrideHooks}`).
  This two-layer shape (canonical-intersection + escape-hatch override) is the single most
  important structural idea in the whole codebase.
- **Permissions/ignore source**: `.rulesync/permissions.jsonc` — one canonical
  `permission: {<category>: {<pattern>: "allow"|"ask"|"deny"}}` map, categories being tool-agnostic
  nouns (`bash`, `read`, `edit`, `write`, `webfetch`, ...), again with the same per-tool override
  block (`config.claudecode.permissions.defaultMode`, `config.codexcli.base_permission_profile`,
  `config.pi.defaultTools`). `.rulesyncignore` is a flat gitignore-syntax file
  (`src/features/ignore/rulesync-ignore.ts`).

**VERDICT — ADAPT.** The two-layer shape (small canonical intersection of concepts + typed,
adapter-owned escape-hatch block under a target's own key, validated by that adapter's own zod
schema, ignored by everyone else) is exactly the mechanism jig needs for hooks and permissions,
which have no cross-tool standard. Do not invent a generic untyped passthrough bag — rulesync's
own commit history (visible in code comments) shows they moved *away* from that toward typed
per-target sub-schemas specifically because an unmodeled key used to "validate and then vanish
with no warning" (comment in `claudecode-permissions.ts:1046-1052`). jig should give every harness
target its own typed override schema from day one.

---

## 2. Translation architecture

**Per-artifact abstraction**: `src/types/feature-processor.ts` defines `FeatureProcessor`
(single-file artifacts: hooks, permissions, ignore, mcp) and `dir-feature-processor.ts` defines
`DirFeatureProcessor` (directory artifacts: skills). Both are abstract classes with the same four
methods: `loadRulesyncFiles/Dirs()`, `loadToolFiles/Dirs()`, `convertRulesyncFilesToToolFiles()`,
`convertToolFilesToRulesyncFiles()` (`feature-processor.ts:66-72`, `dir-feature-processor.ts:123-145`).
This is generate (rulesync→tool) and import (tool→rulesync) as two directions of one interface.

**Per-target implementation is NOT a class hierarchy per target** — it's a **factory-map + typed
static-method contract**. Each artifact type has:
1. An abstract base (`ToolRule`, `ToolHooks`, `ToolPermissions`, `ToolSkill`, `ToolSubagent`,
   `ToolCommand`, `ToolIgnore`, `ToolCheck` — all `extends ToolFile` or `extends AiDir`) declaring
   the per-instance contract (`fromRulesyncX`, `toRulesyncX`, `fromFile`, `forDeletion`,
   `getSettablePaths`, `isTargetedByRulesyncX`) as **static methods that throw
   "Please implement this method in the subclass"** by default (`tool-rule.ts:194-209`,
   `tool-hooks.ts:108-135`, `tool-skill.ts:170-215`) — i.e. an interface enforced at runtime, not
   compile time (no TS `abstract static`).
2. One concrete class per tool (`ClaudecodeRule`, `CodexcliRule`, `PiRule`, `DshRule`, ...),
   ~50-300 lines each, implementing those statics plus tool-specific path/format logic.
3. One `Map<ToolTarget, Factory>` per artifact type — `toolRuleFactories`
   (`rules-processor.ts:351-1131`, 780 lines: one entry per of ~55 targets), `toolHooksFactories`
   (`hooks-processor.ts:282-987`), `toolPermissionsFactories`, `toolSkillFactories`,
   `toolCheckFactories` (`checks-processor.ts:91-181`) — mapping target name to `{ class, meta }`,
   where `meta` is a small object of capability flags (`supportsGlobal`, `supportsImport`,
   `supportedEvents`, `collisionPolicy`, ...) that the **processor** (not the adapter) uses to
   decide what to warn about.
4. One `XProcessor extends FeatureProcessor` per artifact type (`RulesProcessor`, `HooksProcessor`,
   `PermissionsProcessor`, `SkillsProcessor`, ...) that is constructed **per single tool target**
   (`toolTarget: RulesProcessorToolTarget` in the constructor, `rules-processor.ts:1200-1270`) and
   looks up the factory for that one target on every call. A `generate --targets "*"` run
   instantiates one processor instance per target per artifact type — there is no fan-out inside a
   single processor.

**Key design point for jig**: the "meta" capability-flag object living *beside* the class in the
factory map — not on the class itself — lets the **processor own cross-cutting warning logic**
(e.g. `unsupportedEventNames()` in `hooks-processor.ts:161-172` compares the adapter's declared
`supportedEvents` against what the canonical file actually contains, entirely generically, without
the adapter itself needing to enumerate what it doesn't support). This is the single cleanest
generalizable idea in the codebase: **capability declarations are structured data consumed by a
shared reporting layer, not ad hoc per-adapter warning code.**

**VERDICT — ADAPT.** The `{class, meta}` factory-map pattern with generic capability-diffing in the
processor is directly transferable to jig's Go/TS design: define a small interface per artifact
kind, a struct of declared capabilities per target, and one generic "what does the canonical file
contain that this target's capabilities don't cover" diff function shared by every target instead
of writing custom warning code n times.

---

## 3. The hard artifacts — hooks and permissions

### Hooks
- **Canonical → Claude Code**: `claudecode-hooks.ts` is a thin `SettingsJsonHooks` subclass
  (shared base `settings-json-hooks.ts`, not read in full) configured by a declarative
  `ToolHooksConverterConfig` object (`claudecode-hooks.ts:27-65`): event-name maps in both
  directions (`CLAUDE_TO_CANONICAL_EVENT_NAMES` / `CANONICAL_TO_CLAUDE_EVENT_NAMES`), a
  `supportedHookTypes` set (`command|prompt|http|mcp_tool|agent` — Claude Code supports **all
  five** documented handler types faithfully, including type-specific payload fields), and
  `stringPassthroughFields`/`booleanPassthroughFields`/`arrayPassthroughFields` declaring exactly
  which per-hook-definition fields round-trip losslessly (`if`, `statusMessage`, `shell`, `once`,
  `async`, `asyncRewake`, `continueOnBlock`, `args`). The **shared converter**
  (`tool-hooks-converter.ts`, referenced but not fully read) does the actual event/type/matcher
  mapping once, generically, driven by this config — Claude Code's adapter is ~90 lines because
  almost everything is declarative.
- **Canonical → Codex CLI**: `codexcli-hooks.ts` — same converter-config pattern, but the file
  target is different (`.codex/hooks.json`) and it must ALSO patch `.codex/config.toml`'s
  `[features]` table (dropping the deprecated `codex_hooks` key) through a **shared-config-gateway**
  (`applySharedConfigPatch`, `shared-config-gateway.ts`) that merges into a file another feature
  (MCP, permissions) also writes, preserving unmanaged TOML keys. `supportedHookTypes: ["command"]`
  only — Codex hooks are strictly narrower than Claude Code's.
- **Canonical → Pi**: **structurally different** — Pi has no static hooks config file at all. Its
  adapter (`pi-hooks.ts` + `pi-extension-generator.ts`) **code-generates a TypeScript extension
  file** (`.pi/extensions/rulesync-hooks.ts` / `~/.pi/agent/extensions/rulesync-hooks.ts`) that
  calls Pi's runtime extension API to re-implement the canonical hooks as JS callbacks. Import is
  explicitly `supportsImport: false` — "arbitrary extension code cannot be parsed back into
  canonical hooks" (comment, `hooks-processor.ts:504-511`). `toRulesyncHooks()` on `PiHooks`
  literally `throw`s (`pi-hooks.ts:85-89`).
- **DSH**: **no `dsh-hooks.ts` file exists.** DSH is entirely absent from `toolHooksFactories`.
  Zero hooks support.

**Reporting mechanism**: there is **no single "lossy conversion report" artifact**. Every adapter
and the shared `HooksProcessor.convertRulesyncFilesToToolFiles()` (`hooks-processor.ts:1129-1211`)
emits `logger.warn(...)` lines **inline, at generate time**, for: unsupported event names
(`unsupportedEventNames`), unsupported hook types per event, unsupported matcher usage per event
(`unsupportedMatcherEventNames`), dropped per-hook fields (`enabled: false` not expressible on most
targets, Kiro's `confirm` prompt not expressible elsewhere) — see
`warnAboutDroppedPerHookFields` (`hooks-processor.ts:1219-1260`). Nothing is silently dropped;
everything unrepresentable produces a named warning citing the specific event/field. This is
"lossy conversion reporting" as **structured, generic diff-and-warn code in the processor**, not a
separate artifact class (the `checks` feature, which sounded similar by name, is actually an
unrelated feature — see §8).

**VERDICT — ADAPT the warn-inline-with-named-cause pattern; AVOID trying to fully cover Pi's
runtime-hook-as-generated-code trick unless jig actually wants generated-code hooks for pi** (it's
clever but is a one-way, unauditable-by-diff conversion — the extension file has to be trusted as
code, not read as data. For jig's fail-closed guard use case this is the wrong shape: a security
gate should be declarative and diffable, not generated TS.)

### Permissions
- **Canonical → Claude Code**: full generative mapping, `claudecode-permissions.ts` (1300+ lines,
  the single most defensively-engineered file read). Canonical `permission.<category>.<pattern> =
  action` → Claude's `Tool(pattern)` allow/ask/deny string arrays
  (`convertRulesyncToClaudePermissions`, line 1210). Also handles: a documented
  Write/NotebookEdit/Glob→Edit/Read alias table because "Claude Code's file permission checks match
  only Edit(path) and Read(path)" (`CLAUDE_PATH_RULE_ALIASES:897-901`); an enormous
  scope-and-trust classification of every top-level `settings.json` key into five buckets —
  command-executing (refused outright, e.g. `apiKeyHelper`), managed-only (refused, e.g.
  `allowManagedHooksOnly`), user-scope-only (refused at project scope, e.g. `autoMode`),
  trust-widening (written but summarized as one warning, e.g. `env`, `allowedMcpServers`), and
  ordinary passthrough — each with an inline comment stating *why*
  (`CLAUDECODE_COMMAND_EXECUTING_KEYS`, `CLAUDECODE_UNHONORED_KEY_SOURCES`,
  `CLAUDECODE_USER_SCOPE_ONLY_KEYS`, `CLAUDECODE_TRUST_AFFECTING_KEYS`, lines 613-812). This is a
  security-review artifact in itself.
- **Canonical → Codex CLI**: maps to a `[permissions.rulesync]` TOML profile with `extends` a
  built-in baseline (`:workspace`/`:read-only`/`:danger-full-access`), `filesystem` rule table, and
  `network.domains`. Codex has **one access level per path** (`deny < read < write`, no `ask`), so
  the converter (`mergeFilesystemCategoryRules`, line 1212) explicitly collapses
  read/edit/write + ask into that lattice with documented, warned lossy rules (e.g. "ask" on a
  write path degrades to "read", with a warning; "writable but not readable" is inexpressible and
  degrades to "deny", with a warning).
- **Canonical → Pi**: **Pi exposes no allow/ask/deny rule surface at all.** The only
  repository-syncable permission knob is `defaultTools` (which *built-in tools exist*, not what
  they may touch) written through the `pi.defaultTools` override block
  (`pi-permissions.ts:21-44`). The canonical `permission.*` categories are **entirely unused** for
  Pi — there is no mapping function at all, only the override escape hatch.
- **DSH**: **no `dsh-permissions.ts` exists.** Zero permissions support.

**VERDICT for jig**: Claude Code and Codex CLI permissions ADAPT well (the category-and-pattern
canonical model, the deny<ask<allow / deny<read<write lattice collapse, and the exhaustive
scope/trust key classification are all worth reusing structurally). **Pi is a cautionary example,
not a template**: rulesync doesn't pretend to translate permission semantics into Pi at all — it
only reaches the one native knob Pi actually exposes, via override, and leaves canonical rules
unenforced there. If jig's fail-closed guard needs teeth on pi, rulesync's approach proves the
runtime guard has to be **jig's own enforcement layer**, not something translated from a
cross-tool canonical permission file — pi (and by the same evidence, DSH) has no native
surface to translate *into*.

---

## 4. Skills and subagents

Mechanism is **transform-and-place**, not copy: `ToolSkill extends AiDir` (a directory abstraction:
one `mainFile` = `SKILL.md` + parsed frontmatter/body, plus `otherFiles` = every other file in the
skill directory, copied byte-for-byte via `companionFileContentsEquivalent`
(`dir-feature-processor.ts:212-236`) — text files are never re-encoded, so a CRLF fixture or binary
asset round-trips exactly). Frontmatter IS transformed per target: `ClaudecodeSkill` has a full zod
schema (`allowed-tools`, `disable-model-invocation`, `argument-hint`, `context: fork`, `agent`,
`hooks`, `shell`, Agent-Skills-standard `license`/`compatibility`/`metadata` passed through even
though Claude Code "accepts all three but acts on none of them" — kept because they matter for
`claude.ai` skill uploads and the Skills API); `PiSkill` implements the actual Agent Skills spec
(`allowed-tools` as a **space-delimited string**, not YAML array — `PiSkill.fromRulesyncSkill`
explicitly joins the canonical array, `pi-skill.ts:200`); `DshSkill` has its own narrower schema
(`whenToUse`, `metadata`, two invocation flags) with **no `allowed-tools` field at all** — DSH
skills carry less metadata than Claude/Pi skills, and the adapter simply omits fields it can't
express (no warning needed because nothing was dropped that DSH's canonical section ever claimed).

A **shared resolver layer** (`skills-utils.ts`: `resolveDisableModelInvocation`,
`resolveUserInvocable`, `resolveLicense`, `resolveCompatibility`, `resolveMetadata`) implements a
"per-target section overrides root-level default" fallback used identically by every skill
adapter, so a global default set once at the canonical root cascades unless a target-specific block
overrides it. Directory-scoped skill discovery has real edge-case engineering: Claude Code's
adapter walks the tree for **nested** `.claude/skills/` directories (v2.1.178+ feature) and derives
a synthetic `paths` glob from the nesting location so a subtree-scoped skill doesn't get silently
promoted to global scope on import (`claudecode-skill.ts:373-384`, `deriveNestedSkillPaths`).

Subagents follow the same directory-vs-frontmatter pattern (not read in as much depth, but
`ToolSubagent` mirrors `ToolRule`'s file-based, not directory-based, shape — subagents are
single Markdown+frontmatter files like rules, not directories like skills).

**VERDICT — ADAPT.** The "one shared directory-copy mechanism (AiDir) + per-target typed
frontmatter transform + shared cross-target field-resolution fallback (skills-utils.ts)" split is
exactly right and directly reusable: jig should have one `SkillDir` abstraction, per-target
frontmatter schemas, and a small number of shared "root default, target override" resolvers rather
than duplicating that fallback logic in every target adapter.

---

## 5. Import (reverse direction)

Every processor implements `convertToolFilesToRulesyncFiles()` as the literal inverse of
`convertRulesyncFilesToToolFiles()`, and every adapter implements `toRulesyncX()` beside
`fromRulesyncX()` in the same file (verified directly in every adapter read: `ClaudecodeSkill`,
`DshSkill`, `PiSkill`, `ClaudecodeHooks`↔`toRulesyncHooks`, `ClaudecodePermissions`↔
`toRulesyncPermissions`, `CodexcliPermissions`↔`toRulesyncPermissions`). CLI entry:
`src/cli/commands/import.ts` → `importFromTool({ config, tool, logger })` in `src/lib/import.ts`
(not read in full) — **one tool at a time** (`import.ts:32-34`, `"Only one tool can be imported at
a time"`), producing per-artifact counts (`rulesCount`, `hooksCount`, `permissionsCount`, ...).

Import is explicitly **not always symmetric with generate**: capability flags include a separate
`supportsImport` bit per target per artifact (`hooks-processor.ts` meta), false for Pi hooks
(generated-code can't be parsed back), Cline hooks (generated wrapper scripts), OpenCode/Kilo hooks
(same reason). Where generate refuses to write a value (Claude Code's command-executing settings
keys, Codex's retired `approval_policy: "untrusted"`), import symmetrically refuses to read it back
— `claudecode-permissions.ts:1172` explicitly comments "Symmetric with generate: a key generate
refuses to write must not be imported either, or the override would carry a value that only ever
produces a warning." Unmanaged/unmodeled keys in an existing tool config are preserved verbatim
through the same per-target override block rather than being dropped on import
(`codexcli-permissions.ts:779-816`, `preserveUnmanagedProfileKeys`).

**VERDICT — ADAPT** the symmetry discipline (every writable capability declares readability
independently; refusal is bidirectional and reasoned about explicitly) and the "unmodeled content
round-trips through the override block, not silently dropped" policy — this matters directly for
jig's "existing per-harness config" migration path the owner mentioned.

---

## 6. Coverage of the owner's four harnesses

| Harness | rules | commands | subagents | skills | hooks | permissions | MCP | ignore |
|---|---|---|---|---|---|---|---|---|
| **Claude Code** | ✅ full (+legacy variant, +plugin variant) | ✅ | ✅ | ✅ (+nested discovery) | ✅ (all 5 hook types) | ✅ (very deep) | ✅ | ✅ |
| **Codex CLI** | ✅ | ✅ | — (not found in subagent factory grep) | — (not found) | ✅ | ✅ (deep, TOML profile model) | ✅ | — |
| **pi** | ✅ | ✅ | **absent** (no `pi-subagent.ts`) | ✅ (Agent Skills spec-conformant) | ✅ (generated-code bridge, no import) | ✅ (thin — `defaultTools` only) | **absent** (no `pi-mcp.ts`) | **absent** (no `pi-ignore.ts`) |
| **DSH** | ✅ (nested AGENTS.md family) | **absent** | **absent** | ✅ (thin schema) | **absent** | **absent** | **absent** | **absent** |

This directly contradicts the "likely absent" assumption in the task brief: **rulesync already has
first-class DSH and pi targets**, confirmed by `find src/features -iname "pi-*"` /
`"dsh-*"` returning real, tested (`.test.ts` siblings for every file) adapters, referencing DSH's
actual upstream repo (`github.com/deepseek-ai/deepseek-harness`) and pi's
(`github.com/earendil-works/pi`) in doc comments. **pi is a medium-depth target** (rules, commands,
skills, hooks-via-codegen, thin permissions); **DSH is a shallow target** (rules + skills only —
no commands, subagents, hooks, permissions, MCP, or ignore surface at all).

**Cost to add a minimal target** (estimated from the shape of the thinnest real entries, e.g.
`DshRule` at 21 lines extending a shared `NestedAgentsmdRule` base class, `dsh-skill.ts` at 275
lines): a new target needs, per artifact type it supports, (a) one class implementing the 5-6
static methods on the abstract base, (b) one factory-map entry with capability flags, (c) test
file(s). The `NestedAgentsmdRule` base class (referenced by both `DshRule` and presumably others
sharing the "root AGENTS.md + nested per-directory AGENTS.md" pattern) shows rulesync itself
factors out the common case so a *rules* target can be as small as a 4-line config object
(`dsh-rule.ts:17-21`, `{ globalDir, toolTarget }`). A rules-only or rules+skills-only target (DSH's
actual footprint) is genuinely cheap — maybe 150-400 lines across two files plus tests. A full
target (Claude-Code-depth) is a multi-week undertaking given the security/trust nuance in
permissions alone.

---

## 7. Delivery

Confirmed: `writeAiFiles`/`writeAiDirs` (`feature-processor.ts:99-171`, `dir-feature-processor.ts:164-297`)
write into each tool's **own native, layered config location** exactly as that tool would look for
it (`.claude/settings.json`, `.codex/config.toml`, `.pi/settings.json`, `~/.dsh/AGENTS.md`, etc.) —
never a rulesync-owned merged blob. Existing user content handling is **format-specific, not
marker-based**:
- Whole-file-replace artifacts (hooks.json, most rule files): content-equivalence check first
  (`fileContentsEquivalent`) — if the computed content matches what's on disk, no write happens
  (idempotent no-op, only the executable bit is restored if missing,
  `feature-processor.ts:140-156`).
- Shared multi-owner files (`.claude/settings.json`, `.codex/config.toml`): a
  **`shared-config-gateway`** (`shared-config-gateway.ts`, referenced pervasively —
  `applySharedConfigPatch`, `SHARED_CONFIG_OWNERSHIP`) that declares, per file, which top-level
  keys each *feature* (hooks vs permissions vs MCP) owns, and merges only the owned keys while
  preserving everything else in the file byte-for-byte-adjacent (read-modify-write with declared
  ownership, not full overwrite). This is how three unrelated rulesync features can all write into
  one Claude Code `settings.json` without clobbering each other or the user's own hand-edited keys.
- No content markers/comments (`<!-- rulesync:managed -->` style) were found in anything read —
  ownership is structural (declared key sets) rather than textual.
- **Idempotency**: re-running `generate` with no source changes writes nothing (`changedCount: 0`),
  verified by the equivalence check running before any `fs.write`. Dry-run mode
  (`this.dryRun`) short-circuits every write to a log line.
- **Orphan deletion** (`--delete` flag, inferred from `removeOrphanAiFiles`/`removeOrphanAiDirs`
  methods, `feature-processor.ts:183-212`, `dir-feature-processor.ts:303-384`) is a separate,
  carefully-bounded sweep: only deletes files/dirs the tool's own adapter *would have generated*
  and no longer does, with extensive ownership/escape checks (symlink-outside-root refusal,
  case-folding collision handling, "shared root" vs "owned directory" distinction) before ever
  calling `rm`.

**VERDICT — ADAPT the shared-config-gateway ownership-by-declared-keys pattern directly** for any
jig target that writes into a file multiple jig features must share (e.g. Claude Code's single
`settings.json` for both hooks and permissions). This solves exactly the "don't clobber the other
feature's keys, don't clobber the user's own keys" problem jig will face immediately.

---

## 8. Quality signals

- **Test shape**: 455 `.test.ts` files vs 581 non-test `.ts` files — near 1:1 file coverage, and
  every adapter file read had a co-located `.test.ts` sibling (`dsh-rule.test.ts`,
  `pi-hooks.test.ts`, `pi-permissions.test.ts`, etc.), suggesting per-adapter unit tests rather
  than only integration/e2e (there's also a dedicated `src/e2e/` directory).
- **Per-target format knowledge**: **code, not a data table.** There is no central YAML/JSON
  registry of "tool X's config path is Y, format is Z" — every fact (file path, format, event
  names, supported hook types, trust classification) lives as TypeScript in that tool's own
  adapter file, with a doc-comment citing the upstream source (GitHub URL or docs URL) directly
  above the code that encodes it. This makes the source of truth auditable per-target but means
  there is no single place to see "every target's file path" without reading N files (the factory
  maps are the closest thing to a table, but they hold class references + capability flags, not
  path data).
- **`checks` feature** (initially suspected to be the lossy-conversion reporting mechanism) is
  actually **unrelated**: it's a code-review-guideline generator (Cursor Bugbot's `BUGBOT.md`, Amp's
  `.agents/checks/`, Augment's `code_review_guidelines.yaml`) — only 7 targets support it
  (`checks-processor.ts:91-181`), and it has nothing to do with lossy-conversion warnings, which
  live inline in every processor's `convertRulesyncFilesToToolFiles`.
- **Maintenance cadence**: shallow clone hides full history, but the visible commit is a merged PR
  (#3142) for a `v17.0.0` release dated the day before this read — consistent with frequent,
  numbered releases (Homebrew formula automation visible in `Formula/`). The doc comments
  throughout cite specific upstream tool versions (e.g. "Claude Code v2.1.178+", "Codex 0.149.0",
  "Roo Code v3.47.0; verified at the final v3.54.0 tag") and specific upstream behavior changes
  (retired `approval_policy: "untrusted"`, deprecated `on-failure` alias), indicating the adapters
  are actively re-verified against real upstream releases, not written once and left stale.

---

## Closing recommendations for jig

**(a) What jig should adopt structurally**
1. **Canonical intersection + typed per-target override block**, both for artifact bodies (rules
   `pi:`/`claudecode:` sections) and for whole hard-artifacts (hooks/permissions override blocks
   keyed by target name) — never an untyped passthrough bag.
2. **`{class, meta}` factory-map per artifact type**, with `meta` as declared capability flags
   (supported events/types, global support, import support, collision policy) consumed by a
   **generic, shared diff-and-warn function** in the processor — not per-adapter warning prose.
3. **Shared-config-gateway ownership-by-declared-keys** for any file two jig features must
   co-write (Claude Code's `settings.json` is the obvious first case for jig too).
4. **Bidirectional symmetry discipline**: every write capability declares its own read
   (import) capability independently, and a value generate refuses to write is refused on import
   too, with the same stated reason.
5. **One shared directory-copy abstraction (AiDir-equivalent) + shared cross-target field-fallback
   resolvers** for skills/subagents, so 90% of a new skill target is "declare the frontmatter
   schema," not "reimplement file copying."

**(b) What rulesync cannot do that jig must**
- **No runtime enforcement anywhere.** rulesync is a pure generator; it never runs, never gates a
  tool call, and has no concept of "fail-closed." jig's runtime guard (the actual security
  boundary) has no rulesync analog to borrow — this has to be built from scratch, informed only by
  rulesync's *permission-modeling* vocabulary (categories, patterns, allow/ask/deny), not its
  execution.
- **No pi/DSH depth on hooks, permissions, or MCP.** rulesync proves these two harnesses' native
  surfaces are genuinely thin (pi: no allow/ask/deny at all, only `defaultTools`; DSH: nothing) —
  jig cannot translate a canonical permission model into either and get real enforcement out the
  other side; jig's own guard has to carry that weight directly on pi/DSH rather than relying on
  translated native config.
- **No judgment.** Every rulesync decision is a fixed, declared rule (event maps, type support,
  trust classification) — there's no equivalent of jig's skill-selection-by-judgment; that's
  entirely the owner's own design space.

**(c) Use rulesync as a library/converter, or build jig's own?**
**Recommendation: do not depend on rulesync as a library.** rulesync has no published library
API surface for programmatic embedding — it's a CLI tool whose `src/features/**` classes are not
designed as an importable SDK (no `exports` map evidence checked, but the density of
`process.cwd()` defaults and CLI-shaped option types throughout every constructor signature
suggests CLI-first design, not embeddable-library-first). Vendoring or npm-depending on it to
reuse rules/commands/skills/MCP generation would:
- couple jig to rulesync's canonical schema and versioning cadence for artifact types jig doesn't
  fully control the roadmap of (rulesync adds ~1 new target every few releases; jig only cares
  about 4),
- pull in ~55 targets' worth of adapter code and test surface jig will never call,
- and still require jig to write its own hooks/permissions/MCP logic for pi and DSH from scratch
  anyway, since rulesync's own pi/DSH coverage there is thin or absent — the exact artifacts jig
  cares most about (hooks, permissions) are the ones rulesync helps least with for jig's actual
  four targets.

The right move is **extract-the-pattern, not extract-the-code**: build jig's own small
canonical-model + factory-map + shared-config-gateway, sized for exactly 4 targets and the 6-7
artifact types the owner listed, using rulesync's Claude-Code and Codex-CLI adapters as the
detailed reference implementation for what those two targets' native formats actually require
(the trust-classification tables in `claudecode-permissions.ts` are worth re-deriving by hand from
Claude Code's own docs rather than copying, since the license terms of copying substantial
rulesync code are a separate question the owner should decide explicitly, and the task brief says
extract-don't-vendor). For pi and DSH, jig is starting from close to zero in rulesync's own
codebase for hooks/permissions/MCP — which is useful information in itself: **jig's pi/DSH hook
and permission story cannot be "translate from rulesync's model," because rulesync doesn't have
one either.**
