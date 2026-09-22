---
question: "What is the 2026 industry standard for delivering one config (skills, hooks, permissions, rules, MCP, subagents, settings, bundling) to Claude Code, Codex, pi, and DSH symmetrically?"
date: 2026-09-22
verdict: "No artifact type is native across all four harnesses; jig must be the harness-independent translator for permission guards (sharpest gap, since pi has no native permission layer at all), hooks/lifecycle delivery, a rules bridge for Claude Code (which doesn't read AGENTS.md), MCP server inventory, and subagent definitions, while skills content format and AGENTS.md are the closest things to convergent industry standards; bundling/plugins should be skipped in favor of direct native-path file placement, matching universal real-world practitioner practice."
unverified:
  - "Codex CLI's native subagent file format — nav entry confirmed to exist, content not fetched this session"
  - "pi's native MCP config discovery — not confirmed against pi's own docs, only a third-party package's behavior was confirmed"
  - "pi's native AGENTS.md discovery — present and in active use in this repo's pi config, but whether pi's core discovers it natively was not independently confirmed"
  - "DSH's dsh-agent-instructions default candidate filenames — inferred from shape (ordered candidates, root walk, local overlay), not from a literal default-value citation"
  - "whether Claude Code can be configured to read AGENTS.md via some non-default setting — not found, only the no-user-level-AGENTS.md default case was confirmed"
  - "no public repo combining all four harnesses including DSH was found — DSH's developer-preview status makes this plausible rather than a search failure"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# Industry standard (2026): delivering one config to many coding-agent harnesses

Research date: 2026-09-22. Scope: **Claude Code, OpenAI Codex CLI, pi, DSH — treated symmetrically**,
for jig's design. jig is harness-independent: a recommendation only counts if it says what
happens on all four, not just "use Claude Code's native feature."

Method: WebFetch against vendor primary docs (WebSearch budget was exhausted before this task could
use it) + `gh search repos`/`gh search code`/`gh api` against real GitHub repos (per an explicit
correction from the owner mid-task: vendor docs alone are not enough) + reading DSH's own vendored
source tree and jig's own existing per-harness adapters that already live in this repo/worktree,
which are primary sources in their own right — they're ground truth for what's actually running.
All three source types are cited inline as `[docs: URL]`, `[github: owner/repo]`, or `[local: path]`.

## Per-artifact table — all four harnesses read with equal rigor

"Native in all 4?" is marked **NATIVE** only when Claude Code, Codex, pi, and DSH all have it built in
with no bespoke code from the owner. Everything else is marked **DIVERGENT** — which, per the owner's
framing, is itself the finding: it names what jig must supply as the harness-independent layer.

### Skills

| Harness | What it does natively |
|---|---|
| Claude Code | `.claude/skills` (project, walks to repo root, monorepo-aware) / `~/.claude/skills` (user) / enterprise managed dir / plugin `skills/`. Implements the open **Agent Skills** standard (agentskills.io), with Claude-only frontmatter extensions layered on the portable fields. Progressive disclosure: only `name`+`description` loaded at startup, full body loaded on match. [docs: code.claude.com/docs/en/skills] |
| Codex CLI | `.agents/skills` (walks CWD→repo root), `$HOME/.agents/skills`, `/etc/codex/skills`, built-in. "Skills build on the open agent skills standard." [docs: learn.chatgpt.com/docs/build-skills] |
| pi | Same `SKILL.md`/Agent Skills format, at `~/.pi/agent/skills/` **and** `~/.agents/skills/` (global), `.pi/skills/` **and** `.agents/skills/` (project, trust-gated). **But pi renders every installed skill's full name+description into every system prompt unconditionally** — there is no owner-controllable progressive-disclosure gate beyond an all-or-nothing `disable-model-invocation` flag. [github: badlogic/pi-mono, packages/coding-agent/docs/skills.md; local: domains/dev/config/pi/extensions/skill-router.ts header comment, measured "4,674 tokens for 58 skills on this machine"] |
| DSH | Native — `@deepseek-ai/dsh-skill` (registry) + `@deepseek-ai/dsh-skill-filesystem` (local FS provider), scans project/user/bundled roots, watches for changes, default extra root is `$DSH_AGENTS_HOME` (defaults to `~/.agents`) — same `SKILL.md` format. [local: domains/dev/config/claude/jobs/7d3622d8/tmp/deepseek-harness/docs/config-catalog.md §dsh-skill-filesystem] |

**Native in all 4?** Content format: yes (SKILL.md/Agent Skills, and `.agents/skills` as a shared directory is now read natively by Codex, pi, *and* DSH — three of four independently converged on the same path). Selection/cost behavior at scale: **no** — pi's blind full-render is a real gap none of the others have; DSH's selection behavior wasn't verified this session.

**Real-world practice (GitHub):** `domengabrovsek/agent-config` (Claude Code + Codex + Pi, 15★) links shared skills at `~/.agents/skills` for all three hosts — the same convention independently confirmed by the vendor docs above. `eljulians/skillfile` (171★) treats skills as an installable package ecosystem ("Search 110K+ community skills, install and track them declaratively... across Claude Code, Codex, Cursor, Antigravity"). `harmonyos-ai-skill` (270★, tagged "AGENTS.md Standard") ships one skill via 11+ tool install snippets, and for Claude Code specifically its own quickstart is a **plain `ln -s`** into `~/.claude/skills/` — i.e. practitioners symlink skill content directly, they don't wait for a plugin/marketplace step.

**Recommendation, per harness:** Claude Code / Codex / DSH — native-feature, jig only places the `SKILL.md` folder at each harness's native path (symlink or plugin-in-place, both documented as valid). **pi — jig must additionally provide dynamic per-task skill selection** (the owner's own judgment-model skill router is filling a real, pi-specific gap; nothing native solves it, and the closest public analogue is a third-party pi package, not a pi core feature).

### Hooks / lifecycle event handling

| Harness | What it does natively |
|---|---|
| Claude Code | Declarative `hooks` key in any settings.json layer (merges additively) or plugin `hooks/hooks.json`. 5 handler types, 40+ events. [docs: code.claude.com/docs/en/hooks] |
| Codex CLI | Declarative `hooks.json` (`~/.codex/hooks.json`, `<repo>/.codex/hooks.json`) or inline `[hooks]` table in `config.toml`. Project-local hooks require project trust; admin can force managed-hooks-only. [docs: learn.chatgpt.com/docs/config-file/config-advanced] |
| pi | **No declarative hook format at all.** An "extension" is an arbitrary TypeScript module that calls `pi.on(eventName, handler)` against an `ExtensionAPI` (`@earendil-works/pi-coding-agent`), loaded via jiti from `~/.pi/agent/extensions/*.ts` (or the `extensions` array in `settings.json`). Hook-equivalent in effect, fundamentally different mechanism: code, not config. [local: domains/dev/config/pi/extensions/guard.ts — full working example] |
| DSH | Cordis (the vendored plugin framework) has a native typed-event system (`ctx.on()`/`emit`/`waterfall`/`serial`/`bail`) — code-level, same shape as pi's. **But DSH additionally ships two first-party bridge plugins that read Claude Code's and Codex's own hooks.json formats and re-dispatch them as cordis events**: `@deepseek-ai/dsh-hooks-claude-code` (reads a CC `hooks.json`/settings file, substitutes `${CLAUDE_PLUGIN_ROOT}`/`${CLAUDE_PROJECT_DIR}`) and `@deepseek-ai/dsh-hooks-codex` (reads a Codex `hooks.json`, stamps `model` on every payload). [local: .../deepseek-harness/docs/config-catalog.md §dsh-hooks-claude-code, §dsh-hooks-codex; local: domains/dev/config/dsh/README.md "Guard hook" section] |

**Native in all 4?** **No.** pi has zero declarative format (code only); Claude Code and Codex have their own, mutually incompatible declarative formats; DSH has both a code-level event system *and* first-party adapters that speak Claude's and Codex's formats — but the adapters themselves are DSH's admission that no shared format exists, not evidence one does.

**Real-world practice (GitHub):** `domengabrovsek/agent-config` states outright: "Hooks, permissions, notifications, and teammate mechanics remain host-specific" and lists hook "parity" for other hosts as explicitly **deferred**, even in an actively-CI-gated repo covering exactly Claude Code + Codex + pi. `anywhere-agents` (244★) ships a Python `guard.py` dropped into `~/.claude/hooks/` (Claude-only; no cross-harness hook story at all).

**Recommendation, per harness:** Claude Code — generate `hooks.json`/settings block. Codex — generate its own `hooks.json`/`[hooks]` TOML table (different shape, same job). pi — jig must generate actual **TypeScript extension code**, not config (already done: `domains/dev/config/pi/extensions/guard.ts`). DSH — jig already chose to **bypass** the official `dsh-hooks-claude-code` bridge for the guard specifically and instead generate a native cordis plugin (`jig-guard`, `domains/dev/llm/harness/jig/adapters/dsh/src/index.ts`), because the bridge fails open on a crash/timeout and never sees MCP tool calls. **This is the clearest evidence in the whole survey that hooks are irreducibly harness-specific — jig must emit one artifact per harness type (declarative config × 2, code × 2), and even DSH's own "compatibility bridge" wasn't good enough for jig's own correctness bar.**

### Permissions / guard

| Harness | What it does natively |
|---|---|
| Claude Code | `permissions.allow/ask/deny` rule lists in any settings layer, merged additively; a documented set of security-sensitive keys where the strictest value from any scope wins regardless of layer. [docs: code.claude.com/docs/en/settings] |
| Codex CLI | Sandbox modes (`workspace-write`, `danger-full-access`, etc.) + an approval-policy setting; project trust gates whether `.codex/` layers load at all. [docs: learn.chatgpt.com/docs/config-file/config-basic, config-advanced] |
| pi | **No native permission layer of anything.** Confirmed verbatim from the owner's own working code: "pi has no permission layer of its own, so this extension is the only thing between the model and the shell." Every tool call is unguarded unless an extension intercepts `tool_call`. [local: domains/dev/config/pi/extensions/guard.ts, lines 29-37] |
| DSH | Native preset system, `@deepseek-ai/dsh-permission-presets` — a table of `name → {sandbox mode, approval policy}` (same shape as Codex's sandbox+approval, not Claude Code's allow/ask/deny lists), defaults `workspace-write`+ask and `danger-full-access`+never. Also has the `dsh-hooks-claude-code` bridge available for wiring an external policy in — but that bridge fails open on error/timeout and doesn't see MCP calls. [local: .../deepseek-harness/docs/config-catalog.md §dsh-permission-presets] |

**Native in all 4?** **No, and this is the sharpest divergence in the whole survey.** Three different native shapes (allow/ask/deny lists vs. sandbox-mode+approval vs. nothing) plus one harness (pi) with **no native permission concept whatsoever**.

**Real-world practice (GitHub):** `domengabrovsek/agent-config`'s own solution for pi is a **third-party pi package**, `@gotgenes/pi-permission-system`, mechanically enforcing rules an extension (`permission-gate`) derives from Claude Code's deny list — translating `Read`/`Edit`/`Write`/`Bash`/MCP rules into pi's `path_read`/`path_write`/command-pattern surfaces at every session start, deny-only (fallback is always allow), and the README is explicit that "this remains friction, not a sandbox." That is an independent community confirmation, arrived at by a different author, of exactly the gap the owner's own `guard.ts` fills by hand.

**Recommendation, per harness:** this is the artifact type where **jig must provide 100% of the cross-harness consistency** — none of the four gives it for free, and pi gives nothing at all. Claude Code: generate `permissions.allow/ask/deny`. Codex: generate sandbox-mode + approval-policy config. pi: generate a TypeScript extension (already done — `guard.ts`), because there is no config surface to target. DSH: generate a native cordis plugin (already done — `jig-guard`), deliberately bypassing DSH's own Claude-Code-hooks bridge because it fails open and is MCP-blind. **A single canonical policy (jig's `guard-rules.json`) with four translators is not a stopgap — it's the only architecture that can produce a fail-closed, MCP-aware guard on all four, because no native feature does.**

### Rules (always-on instructions)

| Harness | What it does natively |
|---|---|
| Claude Code | `CLAUDE.md`, nearest-directory precedence. **No native user-level `AGENTS.md` support** — confirmed independently in real-world practice below. [docs: code.claude.com/docs/en/settings; github: domengabrovsek/agent-config] |
| Codex CLI | `AGENTS.md` natively, directory-walk CWD→repo root, nested files, closest-to-edited-file wins per the AGENTS.md standard itself. [docs: learn.chatgpt.com/docs/config-file/config-advanced; agents.md] |
| pi | Ships/uses an `AGENTS.md` in practice (confirmed present in this repo's own `domains/dev/config/pi/AGENTS.md`); whether pi's *core* natively discovers `AGENTS.md` vs. it being fed some other way wasn't independently confirmed against pi's own docs this session — flagged below. |
| DSH | Native — `@deepseek-ai/dsh-agent-instructions` reads a fixed user-global instructions file under `$DSH_HOME`, plus ordered, per-directory `instructionFileCandidates` while walking to the project root, plus a `localInstructionFileCandidates` overlay — an AGENTS.md-shaped discovery mechanism (exact default filenames not shown in the generated config-catalog entry, but the shape — walk-to-root, base + local overlay, dedup by trimmed content — matches the AGENTS.md convention DSH's own docs list among its build/test tooling). [local: .../deepseek-harness/docs/config-catalog.md §dsh-agent-instructions] |

**Native in all 4?** **No** — Claude Code is the outlier, confirmed twice over: the vendor docs never mention Claude Code reading AGENTS.md, and a real multi-host repo says so explicitly: *"Claude Code has no user-level `AGENTS.md`, so the bootstrap links `~/.claude/CLAUDE.md` to it."* [github: domengabrovsek/agent-config]

**Real-world practice (GitHub):** this is the single most standardized artifact in practice. `anywhere-agents` (244★, daily-driver since early 2026): one `AGENTS.md` with `<!-- agent:claude -->`/`<!-- agent:codex -->` tag blocks, a generator script renders `CLAUDE.md` and `agents/codex.md` from it on every bootstrap. `iannuttall/source-agents` (124★) takes the *opposite* real-world approach — not generation, but scanning many repos and **converting duplicated CLAUDE.md/AGENTS.md content into an actual symlink** ("Convert symlinks • Fix sourcing"), i.e. some practitioners just point `CLAUDE.md -> AGENTS.md` directly rather than rendering a copy. `domengabrovsek/agent-config` does exactly that symlink move for Claude Code specifically. `PanisHandsome/ai-rules-sync` (119★, zero deps) and `sno-ai/mda` (618★, compiles one `.mda` source to `SKILL.md`/`AGENTS.md`/`MCP-SERVER.md`/`CLAUDE.md` with JSON-Schema validation and Sigstore signatures) both treat rules as the one artifact type worth a dedicated generator/format.

**Recommendation, per harness:** author once as `AGENTS.md` (the real standard: Linux-Foundation-stewarded, Codex-native, DSH-native-shaped, and what pi's own config in this repo already carries). Codex and DSH: native, place directly. Claude Code: **either symlink `CLAUDE.md -> AGENTS.md` (the real-world default, validated by two independent public repos) or generate `CLAUDE.md` with a thin per-agent tag-block syntax (the `anywhere-agents` pattern) if Claude-only sections are ever needed** — both are legitimate 2026 practice; jig should pick symlink-first since the owner's content doesn't currently need Claude-only rule blocks. pi: confirm via pi's own docs (unverified) whether AGENTS.md is discovered natively before assuming a symlink is sufficient.

### MCP servers

| Harness | What it does natively |
|---|---|
| Claude Code | `.mcp.json` (project) / `~/.claude.json` (user + per-project) / settings.json / plugin-bundled `.mcp.json`. No field-level merge — whole definition from highest-precedence source wins, matched by name (settings) or endpoint (plugins/connectors). [docs: code.claude.com/docs/en/mcp] |
| Codex CLI | `mcp_servers.<id>` table in `config.toml` (`command`/`url`/`enabled`/etc.), plus `plugins.<plugin>.mcp_servers.<server>.enabled` to toggle a plugin-bundled server. [docs: learn.chatgpt.com/docs/config-file/config-reference] |
| pi | Not natively confirmed against pi's own docs this session. Real-world evidence: `domengabrovsek/agent-config` uses a **third-party pinned package**, `pi-mcp-adapter`, to load servers from `pi/mcp.json` plus each project's own `.mcp.json`, and states explicitly: **"Pi does not import Claude's MCP configuration."** Precedence there: global `pi/mcp.json` < project `.mcp.json` < `.pi/mcp.json` (highest). [github: domengabrovsek/agent-config] |
| DSH | Native — `@deepseek-ai/dsh-mcp-client`, one cordis plugin instance per server (stdio or Streamable HTTP), tool namespace `mcp__<serverName>__<rawName>` — the **same naming convention Claude Code uses for its own MCP tools**, though the two are independent implementations. [local: .../deepseek-harness/docs/config-catalog.md §dsh-mcp-client] |

**Native in all 4?** **No.** The *protocol* (MCP itself) is industry-standard; the *server-inventory config file format* is not — JSON (Claude Code), TOML (Codex), YAML cordis-plugin-per-server (DSH), and for pi apparently nothing in pi's own core at all (a community package fills the gap, and explicitly does not read Claude's file).

**Recommendation, per harness:** jig generates from one canonical server inventory: `.mcp.json` for Claude Code, `mcp_servers.*` TOML for Codex, one cordis-plugin config entry per server for DSH, and — for pi — jig must generate `pi/mcp.json` in whatever shape the (community-standard, not core-pi) `pi-mcp-adapter` package expects, since pi's own core doesn't read anyone else's MCP config natively.

### Subagents

| Harness | What it does natively |
|---|---|
| Claude Code | Markdown+YAML in `.claude/agents/` (project) / `~/.claude/agents/` (user) / plugin `agents/`. Precedence: managed > CLI flag > project > user > plugin. [docs: code.claude.com/docs/en/sub-agents] |
| Codex CLI | Has a distinct "Subagents" page in its doc nav (confirmed to exist; exact file format not independently fetched this session — flagged unverified). [docs: learn.chatgpt.com/docs, nav index] |
| pi | No subagent primitive in pi core. Real-world solution is a third-party package, `pi-subagents`: shared personas from an `agents/` tree spawn as focused **child pi processes** (not a markdown-frontmatter definition pi itself parses), with worktree-isolated lanes and background runs. [github: domengabrovsek/agent-config] |
| DSH | Native and considerably richer than the other three: `@deepseek-ai/dsh-subagent-acp` spawns a **child process speaking the Agent Client Protocol** (so a DSH subagent can literally be another Claude Code, Codex, or DSH instance), `@deepseek-ai/dsh-agent-loop`'s `agents` array defines multiple named agents inline in `cordis.yml`, and `@deepseek-ai/dsh-experimental-agent-team` / `dsh-experimental-tool-agent-team` provide team/multi-agent orchestration with continuable-subagent providers. [local: .../deepseek-harness/docs/config-catalog.md §dsh-subagent-acp, §dsh-agent-loop, §dsh-experimental-agent-team] |

**Native in all 4?** **No.** Four different mechanisms: flat markdown files (Claude Code), an unconfirmed native format (Codex), a spawned-child-process package (pi), and a full DI-based multi-agent/ACP framework (DSH) that's structurally closer to a real orchestration engine than to Claude Code's flat files.

**Real-world practice (GitHub):** `domengabrovsek/agent-config` again names this a known, explicit gap: "`agents/` — Claude Code expert teammate personas. **Equivalent host mechanics are deferred.**"

**Recommendation, per harness:** jig generates a per-harness artifact from one canonical agent definition (name/description/tools/model/prompt): Claude Code markdown+frontmatter, Codex's native format (needs confirming), a pi child-process persona entry (via `pi-subagents`-shaped config or an equivalent jig-owned extension), and a DSH `cordis.yml` `agents` entry or an ACP-spawned process definition. This is not a symlink case in any of the four.

### Settings / config layering

| Harness | What it does natively |
|---|---|
| Claude Code | 5-level file precedence: managed > `--settings` (CLI) > project-local (`.claude/settings.local.json`) > shared project (`.claude/settings.json`) > user (`~/.claude/settings.json`). Lists merge; a few keys don't. [docs: code.claude.com/docs/en/settings] |
| Codex CLI | 7-level `config.toml` precedence: CLI flags > project (trusted only) > named profile > user > cloud-managed > system > built-in defaults. [docs: learn.chatgpt.com/docs/config-file/config-basic] |
| pi | 2-tier **deep merge**: project `.pi/settings.json` over global `~/.pi/agent/settings.json`, nested objects merged field-by-field rather than whole-block replacement. No managed/enterprise tier, no CLI-flag override layer confirmed. [github: badlogic/pi-mono, packages/coding-agent/docs/settings.md] |
| DSH | **Not a flat precedence stack at all** — a **profile tree**: `dsh --profile <name>` boots an ordered chain of plugin-bundle "patch" layers (`cordis.patch.yml` per profile) plus a user override, closer to a Docker Compose overlay chain than to a JSON/TOML precedence list. `dsh --dump-config` renders the composed tree; there is no single canonical `settings.yaml` the way the other three have a canonical file. [local: domains/dev/config/claude/projects/.../memory/dsh-cli-and-profiles.md — owner's own 2026-09-17 verification against `dsh --help` v0.1.5-rc.2] |

**Native in all 4?** Loosely yes (every harness merges *something* natively, so none of them need an external merge step) — but the **shapes are four genuinely different algorithms** (flat JSON precedence, flat TOML precedence, 2-tier deep merge, profile-tree-of-patches), so there is no shared settings format to target and no single "write one file, all four read it" trick.

**Real-world practice (GitHub):** `domengabrovsek/agent-config` runs an idempotent `setup-hosts.sh --check/--apply/--adopt` that creates/verifies symlinks into each host's *own* native settings locations (never composes a merged file itself) and has to git-filter ephemeral runtime keys Claude Code and pi write into `settings.json` at runtime (`feedbackSurveyState`, `lastChangelogVersion`, `autoMode`) so they don't pollute commits — a concrete gotcha for anyone (including jig) writing directly into a harness's native settings file inside a tracked repo.

**Recommendation, per harness:** jig should stop composing one external merged blob and instead write small, correctly-scoped files straight into each harness's own layers — Claude Code: `.claude/settings.json` (project) / `~/.claude/settings.json` (user); Codex: `.codex/config.toml` (project) / `~/.codex/config.toml` (user) / a named profile; pi: `.pi/settings.json` / `~/.pi/agent/settings.json`, relying on pi's own deep-merge; DSH: a `cordis.patch.yml` per profile, since DSH has no flat settings file to merge into at all — the "settings" artifact for DSH *is* the profile-patch mechanism, not a JSON blob.

### Bundling (skills+hooks+commands+agents+MCP as one shareable unit)

| Harness | What it does natively |
|---|---|
| Claude Code | **Plugins.** `.claude-plugin/plugin.json` + `skills/`/`agents/`/`hooks/hooks.json`/`.mcp.json`/etc. at plugin root. Installed via marketplaces (`marketplace.json`), including **local-path sources that load in place** (documented, symlinked under the cache dir) — the explicit self-hosted/dogfooding case — or zero-install auto-load from `~/.claude/skills/<name>/.claude-plugin/plugin.json`. [docs: code.claude.com/docs/en/plugins, plugin-marketplaces, plugins-reference] |
| Codex CLI | **Plugins**, on the **portable, vendor-neutral `agent-plugins.org` v1.0.0 schema** (TSC includes Amazon, Cursor, Microsoft, OpenAI, Vercel — notably not Anthropic). `.codex-plugin/plugin.json`, discovers `skills/` and `mcp.json` automatically, marketplace via `marketplace.json` (repo-level or `~/.agents/plugins/marketplace.json` for personal use). [docs: developers.openai.com/plugins/build/plugins; agent-plugins.org] |
| pi | **Package list, not a manifest+marketplace.** `settings.json`'s `packages` array is a flat list of GitHub/npm source URLs pi installs directly (`https://github.com/dimk90/pi-context-view`, `npm:@plannotator/pi-extension`, …) — closer to an npm-dependencies model than an app-store model; no plugin manifest schema, no marketplace concept. [local: domains/dev/config/pi/settings.json] |
| DSH | **Cordis plugins, a full dependency-injection framework** — each `@deepseek-ai/dsh-*` package is a real installable npm package (`dsh plugin ...`, pnpm-managed) mounted per-profile via `cordis.patch.yml`; this is a programmatic plugin system (typed services, injected dependencies, typed events), not a config-bundle-with-manifest model. [local: .../deepseek-harness/docs/cordis-primer.md; local: domains/dev/llm/harness/jig/adapters/dsh/src/index.ts — jig's own DSH plugin] |

**Native in all 4?** **No — four incompatible mechanisms**, not degrees of the same thing: manifest+marketplace (Claude Code), portable-schema manifest+marketplace (Codex), flat package-URL list (pi), and a full DI plugin framework with its own package manager verb (DSH).

**Real-world practice (GitHub):** none of the surveyed multi-host repos (`anywhere-agents`, `domengabrovsek/agent-config`, `source-agents`) use Claude Code's plugin/marketplace machinery at all — every one of them **symlinks or generates files directly into each harness's native, non-plugin config paths** (`~/.claude/skills`, `~/.claude/hooks`, `~/.claude/settings.json`, `~/.agents/skills`, pi's `extensions/`). `anywhere-agents`' own "packs" are fetched via `pack add <git-url> --ref <tag>` — a fourth real pattern (git-URL package reference + local composer script), structurally between pi's raw package list and Claude Code's marketplace.

**Recommendation, per harness:** treat "bundling" as **not a delivery mechanism jig should adopt uniformly at all** — it's the one artifact type where real practitioners (not just this project) skip the vendor's own plugin system and go straight to native file placement. Claude Code: symlink or local-marketplace-in-place, either is documented and both are seen in the wild — jig can pick either. Codex: same choice, targeting the portable `agent-plugins.org` schema if a manifest is ever needed. pi: reference or generate entries in the `packages` array (git URL or npm spec), not a plugin.json. DSH: install/reference via `dsh plugin` + a `cordis.patch.yml` profile entry, which is what jig's own adapter already does.

## Real-world survey (GitHub) — summary

`gh` is authenticated (account `esh2n`); `gh search repos`/`gh search code` worked after one transient secondary-rate-limit 403 on a parallel burst (resolved by spacing calls out — `gh api rate_limit` showed the search quota was 30/30 fresh moments later, so it was request pacing, not a real limit). Repos actually read (README + description), not just listed:

| Repo | Stars | Harnesses covered | Delivery mechanism |
|---|---|---|---|
| `yzhao062/anywhere-agents` | 244 | Claude Code, Codex (+"whatever comes next") | One `AGENTS.md` with `<!-- agent:X -->` tag blocks → generator script renders `CLAUDE.md`/`agents/codex.md`; "packs" fetched via `pack add <git-url> --ref <tag>`; drops a Python guard hook straight into `~/.claude/hooks/` |
| `domengabrovsek/agent-config` | 15 | **Claude Code, Codex, pi** | Idempotent symlink bootstrap (`setup-hosts.sh --check/--apply/--adopt`) into each host's own native dirs; `~/.agents/` as the shared skills/rules root; explicitly defers hook/subagent parity as host-specific; uses third-party pi packages (`pi-permission-system`, `pi-mcp-adapter`, `pi-subagents`) to backfill what pi lacks natively |
| `iannuttall/source-agents` | 124 | Any repo with AGENTS.md/CLAUDE.md | Scans many repos, **converts duplicated content into a real symlink**, fixes "sourcing" — the opposite of generation |
| `mfmezger/ai_agent_dotfiles` | 7 | Claude Code, Codex, **Pi**, OpenCode, Gemini CLI | (listed, not read in depth — confirms Pi coverage exists beyond one repo) |
| `sno-ai/mda` | 618 | SKILL.md, AGENTS.md, MCP-SERVER.md, CLAUDE.md | One `.mda` source compiles to all four, JSON-Schema validated, Sigstore-signed — a formalized converter, for agentskills.io/AAIF runtimes |
| `PanisHandsome/ai-rules-sync` | 119 | AGENTS.md, CLAUDE.md, .cursorrules, Copilot, Windsurf, Cline, Aider, Gemini | Zero-dependency convert/sync, rules only |
| `agent-sh/agnix` | 421 | CLAUDE.md, AGENTS.md, SKILL.md, hooks, MCP | Linter/LSP that *validates* all of these, not a delivery tool — evidence the ecosystem treats these as separate artifact types worth separately checking, not one blob |
| `Caph-dev/agents-progressive-disclosure` | 74 | AGENTS.md/CLAUDE.md/SKILL.md | A *skill* that refactors a bloated rules file into a routing entrypoint + reference docs — a community-built answer to the same context-cost problem pi's skill-router solves at the skill layer |
| `hoangnb24/repository-harness` | 1,220 | Any AGENTS.md-reading agent | Installer + **three-way-merge updater** (BASE/LOCAL/UPSTREAM/RESOLVED, transactional activation) — a fourth real delivery pattern distinct from symlink, generate, or plugin-install |
| `harmonyos-ai-skill` | 270 | 11+ tools incl. Claude Code | Claude Code quickstart is a **plain `ln -s`** into `~/.claude/skills/`, no plugin step |
| `hinayoung23/dsh-cordis-plugin-kit` | 2 | DSH/Cordis specifically | Scaffolding + static checks for cordis/DSH plugins — confirms a (tiny, early) real developer ecosystem exists around DSH's plugin model, consistent with the "developer preview" status in the owner's own README |
| `rulesync` (dyoshikawa) | — (checked via WebFetch, not gh) | 40+ tools | One-way generator from `.rulesync/`, now covers rules/MCP/commands/subagents/skills/hooks/permissions — confirmed still a converter, not a runtime delivery engine |

**What this changes versus a docs-only read:** vendor docs (Claude Code, Codex) push plugins/marketplaces as the 2026 answer; **real multi-host dotfiles repos overwhelmingly do not use them** — they symlink or generate directly into native, non-plugin paths, and every one of them treats hooks, permissions, MCP config, and subagents as host-specific surfaces requiring bespoke per-host code, exactly the shape jig already has (`apply-claude.ts`, `apply-guard.ts`, `to-claude-permissions.ts`, `write-pi.ts`, `write-dsh.ts`, pi's `guard.ts`, DSH's `jig-guard` cordis plugin). No public repo covers Claude Code + Codex + pi + **DSH** together — DSH is niche enough (developer preview) that jig's own worktree is, as far as this search could tell, the most complete four-harness integration that exists.

## What jig must provide because at least one harness lacks it natively

This is the harness-independent layer — not a nice-to-have, the *load-bearing* part of jig, since without it at least one of the four harnesses gets nothing:

1. **A fail-closed, MCP-aware permission guard.** pi has zero native permission layer — no jig, no guard. DSH's own official Claude-Code-hooks bridge fails open and is MCP-blind — jig deliberately bypasses it. Claude Code and Codex each have *a* native permission surface, but neither is fail-closed by default and neither is what jig's own guard-rules.json speaks. **All four need a jig-authored translator from one canonical policy; none of the four provide this for free, and pi provides nothing at all to build on.**
2. **Hook/lifecycle delivery in the harness's own mechanism, code or config.** Two config formats (Claude Code's hooks.json-shaped settings, Codex's hooks.json/TOML) and two code-level event systems (pi's `pi.on()` extensions, DSH's cordis `ctx.on()`) — no shared wire format exists, confirmed by real practitioners explicitly deferring hook parity rather than solving it.
3. **A rules bridge for the one harness that doesn't read the standard.** AGENTS.md is the real cross-harness standard (Codex-native, DSH-shaped, pi likely) — except Claude Code, confirmed by real-world practice to need either a `CLAUDE.md -> AGENTS.md` symlink or a small per-agent-block generator.
4. **An MCP server-inventory translator into (at least) four different file shapes** — `.mcp.json` (Claude Code), `mcp_servers.*` TOML (Codex), a cordis-plugin entry per server (DSH), and whatever the community pi-mcp-adapter package expects (pi's own core reads none of this).
5. **A subagent-definition translator into four structurally different mechanisms** — flat markdown (Claude Code), an unconfirmed Codex native format, a spawned-child-process persona (pi, via a third-party package), and a cordis `agents` array or ACP-spawned process (DSH, which is closer to real multi-agent orchestration than to the other three).
6. **Dynamic, per-task skill selection for pi specifically.** Claude Code's and Codex's native Agent Skills progressive disclosure already solves the context-cost problem; pi's blind full-render does not, and the owner's judgment-model skill router is filling that gap — keep it, since nothing native (and nothing found in the public survey beyond one skill that manually compacts AGENTS.md) replaces it.
7. **A settings/profile writer that understands four incompatible layering algorithms**, not one merge function — flat JSON precedence, flat TOML precedence, 2-tier deep merge, and DSH's profile-tree-of-patches are not variations on a theme; jig needs one writer per harness, targeting each one's own native scope files/profile layers directly (never composing an external blob), and should account for ephemeral runtime keys some harnesses write into their own settings files (confirmed gotcha in real-world practice).

## Unverified / flagged

- **Codex's native subagent file format**: nav entry confirmed to exist, content not fetched this session.
- **pi's native MCP config discovery**: not confirmed against pi's own docs; only a third-party package's behavior (`pi-mcp-adapter`, which explicitly does not read Claude's config) was confirmed via a real-world repo.
- **pi's native AGENTS.md discovery**: an `AGENTS.md` is present and in active use in this repo's own pi config, but whether pi's *core* discovers it natively (vs. some other loading path) wasn't independently confirmed against pi's own docs.
- **DSH's `dsh-agent-instructions` default candidate filenames**: the config schema shows the *shape* (ordered candidates, project-root walk, local overlay) but the generated docs didn't show the literal default filename list, so "DSH reads AGENTS.md by default" is inferred from shape and from DSH's own docs elsewhere listing AGENTS.md among its build/test conventions, not from a literal default-value citation.
- **Whether Claude Code can be configured to read AGENTS.md via some non-default setting**: not found; only "no user-level AGENTS.md" was confirmed, and only for the default/user-level case.
- **No public repo combining all four harnesses (including DSH) was found** — DSH's developer-preview status and the recency of `@deepseek-ai/dsh-hooks-claude-code`/`dsh-hooks-codex` make this plausible rather than a search failure, but it means the "four-harness" comparison for DSH leans more heavily on DSH's own vendored source and jig's own existing adapter than on independent third-party practice, unlike the other three harnesses.
- Two `gh search code` calls hit a transient secondary rate limit (403) when issued in a parallel burst; resequencing to one call at a time resolved it and `gh api rate_limit` showed full quota moments later — noted in case a future search needs to space calls out.
