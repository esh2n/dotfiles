---
question: "Should a multi-harness config (Claude Code, Codex, pi, omp, DSH) keep a separate commands/ source category, now that slash commands and skills have started converging across harnesses in 2026?"
date: 2026-09-22
verdict: "Claude Code has genuinely folded commands into skills as a file-format matter, backed by real 2026 practitioner migrations, but this is not settled industry-wide across all five harnesses — pi actively maintains two separate, differently-discovered formats with real behavioral differences, and omp (a pi fork) chose to drop the separate primitive — so a shared config should keep command as a distinct concept at the authoring layer even if the compiled output collapses it into a skills file (with disable-model-invocation) for Claude Code, Codex, and omp, while still emitting a genuine separate prompt-template file for pi."
unverified:
  - "No token/context-cost benchmark comparing a commands/ directory's footprint against an equivalent skills/ tree's footprint"
  - "No named individual's blog post, independent of a repo PR/commit, explicitly arguing to keep commands separate from skills in a 2026 multi-harness setup"
  - "No confirmation of the claim that Codex 0.117+ removed slash commands — release notes show sustained skills investment plus one payload-cleanup chore, not a removal"
  - "DSH's own commands-vs-skills story — source unreachable (403), status remains an open question"
  - "No repo-level (not file-hit-level) adoption ratio of commands-only vs skills-only vs both"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# Slash commands vs skills in 2026 — should a multi-harness config keep a separate `commands/` source category?

Survey date: 2026-09-22. Scope: Claude Code, Codex, pi, omp, DSH.

## Method and verification legend

- **Direct fetch (verbatim)**: WebFetch against vendor `.md` doc URLs, `gh api`/`gh search` output, and local `--help` / config output run on this machine. Quoted text below marked `>` was returned inside a WebFetch summary, not raw HTML — WebFetch always runs a small model over the page, so even "verbatim" quotes here passed through that summarizer. Treat them as high-confidence but not byte-exact.
- **Local CLI ground truth**: `pi --help`, `omp --help`, and `~/.pi/agent/settings.json` were read directly from this machine's installed binaries/config — these are primary evidence, not summarized.
- **Not reachable**: DSH's npm docs page (403), `pi-mono` root README (no prompt/skill detail in the fetched excerpt), omp's own repository (does not exist publicly — only a Homebrew tap was found).
- **WebSearch**: unavailable for this session (budget exhausted before any query returned results — confirmed by the tool itself, not assumed). All open-web lookups beyond vendor doc URLs went through `gh search`/`gh api` (GitHub-scoped) instead.
- `gh search code` / `gh search commits` are **not** exhaustive counts — GitHub's code/commit search caps result pages and result freshness varies. Numbers below are lower bounds / samples, stated as such.

---

## Lens 1 — Vendors

### Claude Code (code.claude.com)

`skills.md` (fetched directly):

> Custom commands have been merged into skills. A file at `.claude/commands/deploy.md` and a skill at `.claude/skills/deploy/SKILL.md` both create `/deploy` and work the same way. Your existing `.claude/commands/` files keep working. Skills add optional features: a directory for supporting files, frontmatter to control whether you or Claude invokes them, and the ability for Claude to load them automatically when relevant.
>
> Prefer a skill for new work, since skills also support supporting files.

Frontmatter that reproduces every behavior a separate `commands/` directory used to buy:

- `disable-model-invocation: true` — Claude cannot auto-invoke; only `/name` triggers it. Anthropic's own stated use case: `/commit`, `/deploy`, `/send-slack-message` — "You don't want Claude deciding to deploy because your code looks ready."
- `user-invocable: false` — inverse: hidden from the `/` menu, Claude-only, for background knowledge.
- `allowed-tools` — pre-approves tools for the invoking turn only (clears on next message).
- Arguments: `$ARGUMENTS` (all args as string), `$0`/`$1`/... (indexed, via an `arguments:` frontmatter list), matching the old commands' `$ARGUMENTS`/`$1` syntax feature-for-feature.

`slash-commands.md` (fetched directly) confirms this is a real, still-existing page (not a 404/redirect stub) and adds: `disallowed-tools`, `context: fork` (isolated subagent), and dynamic shell injection (`` !`command` ``) — features with no equivalent in the legacy `commands/` format, i.e. skills are a strict superset.

No deprecation timeline or removal date for `.claude/commands/` was found in either page — it's stated as "keeps working," not sunset.

Sources: https://code.claude.com/docs/en/skills.md , https://code.claude.com/docs/en/slash-commands.md

### Codex (learn.chatgpt.com / developers.openai.com)

`codex/reference/slash-commands` (fetched directly):

> Enabled skills also appear in the slash command list. Custom prompts appear as `/prompts:<name>` commands.

So Codex keeps **three** surfaces converging on one `/` menu: built-in commands (`/plan`, `/model`, `/mcp`, ...), custom prompts (legacy `~/.codex/prompts/*.md`, exposed as `/prompts:<name>`), and skills (`$name` mention or `/skills` list). This matches what this session's own environment shows: the skills roster includes `prompts:explain`, `prompts:fix-error`, `prompts:refactor`, `prompts:write-test` — Codex custom prompts surfaced through the unified listing.

`codex/build-skills` (fetched directly): SKILL.md required (`name`, `description`), discovered from `.agents/skills` (cwd/repo/home) or `/etc/codex/skills`; invoked via `$skill-name` or, in ChatGPT, `@`. Optional `agents/openai.yaml` for `allow_implicit_invocation` policy.

**The "0.117+ removes slash commands" claim in the task brief could not be verified.** Pulled the actual `rust-v0.117.0` GitHub release body directly (`gh api repos/openai/codex/releases/tags/rust-v0.117.0`) — its contents are plugins-as-first-class-workflow, sub-agent addressing, `/title` picker, image workflows. No slash-command removal entry. Grepping `rust-v0.114.0` through `rust-v0.119.0` release bodies for "skill"/"prompts"/"slash command" instead shows a **skills investment trend**, not a commands removal:
- 0.114.0: "Improved the `$` mention picker by clearly labeling Skills, Apps, and Plugins" + "Added a config switch to disable bundled system skills entirely."
- 0.115.0: skill-scoped managed network domain overrides; "move plugin/skill instructions into dev msg."
- 0.116.0: "skill-creator: default new skills to `~/.codex/skills`"; userpromptsubmit hook.
- 0.118.0: "skills: remove unused skill permission metadata"; "remove skill metadata from command approval payloads"; skills picker pagination fix.
- 0.119.0: "sort skill mentions by display name first"; "Annotate skill doc reads with skill names."

Reading `#15906 chore: remove skill metadata from command approval payloads` closely: this is a payload-shape cleanup, not a removal of the commands feature — plausibly the source of the "0.117 removes slash commands" impression in the brief, but it does not say what the brief claims. **Flagged as unverified / likely mischaracterized.**

Sources: https://learn.chatgpt.com/codex/reference/slash-commands , https://learn.chatgpt.com/codex/build-skills , https://github.com/openai/codex/releases/tag/rust-v0.117.0 , https://github.com/openai/codex/releases (0.114.0–0.119.0 bodies)

### pi (badlogic/pi-mono, pi.dev) — the clearest counter-example

Local ground truth first — `pi --help` on this machine shows **two separate, coexisting flags**:
```
--skill <path>                 Load a skill file or directory (can be used multiple times)
--no-skills, -ns               Disable skills discovery and loading
--prompt-template <path>       Load a prompt template file or directory (can be used multiple times)
--no-prompt-templates, -np     Disable prompt template discovery and loading
```

Vendor docs confirm this is a deliberate two-category design, not a leftover flag. `pi.dev/docs/latest` (fetched):

> Prompt templates - reusable prompts that expand from slash commands.
> Skills - Agent Skills for reusable on-demand capabilities.

`prompt-templates.md` (fetched): discovered from `~/.pi/agent/prompts/*.md` (global) and `.pi/prompts/*.md` (project); invoked with `/name`; argument syntax `$1, $2, ...`, `$@`/`$ARGUMENTS`, `${1:-default}`, `${@:N}`/`${@:N:L}` slicing. **No mention of skills anywhere on this page** — it is not framed as a legacy/deprecated path.

`skills.md` (fetched): discovered from `~/.pi/agent/skills/`, `~/.agents/skills/`, `.pi/skills/`, `.agents/skills/`; requires `SKILL.md` with `name`/`description`; two invocation modes — model-triggered (agent reads the file when a task matches) and user-triggered (registers as `/skill:name`, with typed args appended as `User: <args>`).

pi genuinely keeps commands (as "prompt templates") and skills as two separate on-disk formats with separate discovery paths in 2026 — both happen to be slash-invokable, but a prompt template cannot auto-trigger from model judgment and a skill cannot use `${@:N:L}`-style argument slicing. This is real product differentiation, not naming.

Sources: https://pi.dev/docs/latest , https://pi.dev/docs/latest/prompt-templates.md , https://pi.dev/docs/latest/skills.md , local `pi --help` (pi 0.85.1 per this machine's `lastChangelogVersion`)

### omp (can1357, "oh-my-pi")

No public docs site or source repo was found — `gh repo view can1357/omp` 404s; the only public artifact is the Homebrew tap, described as **"Homebrew tap for omp — the oh-my-pi coding agent."** This confirms omp is a pi-lineage fork/derivative, which is why its env vars (`PI_SMOL_MODEL`, `PI_SLOW_MODEL`, `PI_PLAN_MODEL`, `PI_OFFLINE`) mirror pi's.

Local ground truth — `omp --help` on this machine shows `--skills=<value>`, `--no-skills` (skill-filtering flags) but **no `--prompt-template` / `--no-prompt-templates` flag at all.** Despite forking from a codebase that has the concept, omp appears to have dropped the separate prompt-template primitive and kept only skills (plus generic `--hook`/`-e/--extension` for custom logic). This is direct evidence — read from the installed binary's own `--help`, not inferred — that at least one harness in the target set made exactly the opposite choice from pi: full skills absorption, no separate command source.

Sources: https://github.com/can1357/homebrew-tap (tap description), local `omp --help`

### DSH (cordis / `@deepseek-ai/dsh`)

npm's docs page for `@deepseek-ai/dsh` returned HTTP 403 (not reachable) from this environment. The repo's own local README (`/Users/esh2n/go/github.com/esh2n/dotfiles/domains/dev/config/dsh/README.md`) already carries an internal note: "Model picker — selection is Web-UI-driven (Settings → Models); a `/model` slash command was not found in the docs." No commands-vs-skills distinction could be confirmed or denied for DSH. **Not found — absence of evidence, not evidence of absence.**

Source attempted: https://www.npmjs.com/package/@deepseek-ai/dsh (403)

---

## Lens 2 — Practitioners

No named individual's **blog post** (as opposed to a repo commit/PR) arguing the commands-vs-skills question was locatable without WebSearch. Two concrete practitioner artifacts (PR bodies, which do carry first-person rationale) were found instead:

**opendatahub-io/ai-helpers** (Red Hat's Open Data Hub community tooling project), PR #230, merged 2026-06-26:

> Claude Code has merged commands and skills into a single concept — both create slash commands and work identically. This removes the separate "commands" tool type, converting all 8 commands into skills and simplifying the taxonomy from 4 tool types to 3 (skills, agents, gems).

This is a practitioner reading Anthropic's own framing and acting on it directly — evidence that the vendor's "merged" language is landing as literal justification for deleting the separate category downstream.
Source: https://github.com/opendatahub-io/ai-helpers/pull/230

**haacked/dotfiles** (Phil Haack — former GitHub VP of Engineering, well-known individual practitioner/blogger), PR #22 "Migrate commands to skills," merged 2026-02-02, and a follow-up commit five months later (2026-07-23, "Migrate squash and security-audit commands to skills"):

> Convert all 5 commands (note, support, standup, analyze-permissions, triage-issues) from ai/commands/ to ai/skills/ format with proper SKILL.md frontmatter... Skills with disable-model-invocation: support, standup, analyze-permissions, triage-issues (user-initiated only)

Notable: he used `disable-model-invocation` specifically to reproduce the manual-only trigger behavior his old `commands/` files gave him for free — i.e. he confirms in practice that the frontmatter flag is a full substitute, and that he sustained the migration over 5+ months (it wasn't a one-off experiment he reverted).
Sources: https://github.com/haacked/dotfiles/pull/22 , https://github.com/haacked/dotfiles/commit/b2fa5fc25513bb46428e85007dddc9766838c27a

**Negative evidence sought, not found**: no practitioner repo/commit/PR was located arguing to *keep* a separate `commands/` directory once skills frontmatter is available. This is a real gap in the survey (WebSearch being unavailable limits how hard this was pushed), not a confirmed absence — flagged in "no precedent found" below.

---

## Lens 3 — Measured evidence

No papers, benchmarks, or issue-tracker numbers on the *context cost* of loading command descriptions vs skill descriptions were found. **No numbers** for that specific question.

The only quantitative signal available is raw `gh` search-index counts (all taken 2026-09-22, all lower bounds — GitHub's code/commit search does not return exhaustive totals):

| Query | Count | What it measures |
|---|---|---|
| `path:.claude/commands` (code search) | 222,208 | files/hits under that path across indexed public repos |
| `path:.claude/skills filename:SKILL.md` (code search) | 434,176 | SKILL.md hits under that path |
| `path:.codex/prompts` (code search) | 4,280 | Codex custom-prompt files — roughly 2 orders of magnitude smaller than the Claude Code commands/skills corpora, i.e. a minor surface even where it exists |
| `".claude/skills" ".claude/commands" filename:CLAUDE.md` | 2,328 | repos whose CLAUDE.md mentions both paths — a rough proxy for "still has (or documents) both directories," i.e. coexistence/incomplete-migration state |
| `gh search commits "migrate commands to skills"` | 20 shown, first page only | explicit migration commits, sample below |
| `gh search commits "commands to skills"` | 30 shown, first page only | broader phrasing match, sample below |

These numbers are **not a clean adoption ratio** — they count files/lines, not distinct repos, and include forks, bots, and generic (non-Claude, e.g. Discord-bot) `commands/` directories deleted for unrelated reasons (several of the literal "Delete commands directory" commits found were Discord/WhatsApp bot repos, not agent-harness configs — excluded from the "in the wild" list below).

---

## Lens 4 — In the wild

`gh search commits` for `"migrate commands to skills"` / `"commands to skills"` returned dozens of distinct repos spanning **2026-01-24 through 2026-09-20** (i.e. the entire year to date, right up to 2 days before this survey), not a one-time event. Filtering out unrelated bot repos, five concrete, dated examples:

1. **haacked/dotfiles** — PR #22 merged 2026-02-02, "Migrate commands to skills"; sustained pattern, same repo migrated more commands 2026-07-23. Individual, named, notable practitioner. https://github.com/haacked/dotfiles/pull/22

2. **opendatahub-io/ai-helpers** — PR #230 merged 2026-06-26, "refactor: migrate commands to skills," explicit vendor-taxonomy rationale quoted above (4 tool types → 3). Institutional/community project (Red Hat's Open Data Hub). https://github.com/opendatahub-io/ai-helpers/pull/230

3. **nobug-project/rulesync** (dyoshikawa) — commit `a93d04e`, merged 2026-07-22, "refactor: migrate project commands to skills." Notable because **rulesync is itself a cross-harness config-sync tool** (syncs rules/commands across Claude Code, Cursor, Codex, etc.) — its own migration then mechanically propagated to downstream consumer repos one day later: `dyoshikawa/webseek` (2026-07-22) and `dyoshikawa/ghactivities` (2026-07-23), both "Migrate Rulesync commands to skills." This shows some of the "in the wild" migration count is tooling-driven propagation, not independent per-repo decisions — a bias worth naming. https://github.com/nobug-project/rulesync/commit/a93d04eedb31f90cbf1ec351ccaae5c264aae79f

4. **vip-pan/speccode** — PR #49 merged 2026-09-04 (18 days before this survey), "refactor: migrate commands/ to skills/<name>/SKILL.md layout (release 0.6.0)" — the most deliberate example found: a full staged process (propose → plan → migrate → amend docs → release) shipped as a versioned release dedicated to the migration, not a side effect of another change. https://github.com/vip-pan/speccode/pull/49

5. **ctoforaday/special-circumstances** — commit `745ee35` (2026-09-18) and merge `e8f58b7` (2026-09-19), "mark commands-to-skills shipped and add skills compatibility audit." Most directly relevant to this survey's actual question, because it documents keeping a *visibility* distinction without a separate directory: "Invariant: everything that was a command is intended to be visible. 12 visible operator entry points (10 migrated commands + 2 workflow skills). 25 hidden cognitive/procedural skills." I.e. this repo solved "which things are user-invocable commands vs background knowledge" entirely through frontmatter tiers inside one `skills/` tree — not through a second source directory. https://github.com/ctoforaday/special-circumstances (commit 745ee35)

**Counter-evidence / repos that did NOT collapse the categories, or reversed course:**

- **pi itself** (Lens 1): the clearest structural counter-example — actively maintained, two directories, two doc pages, in 2026.
- **samhvw8/dotfiles** (and its fork `dige04/dotfiles`) — commit `faf01edf` (2026-01-24) deleted ~49 `.claude/commands/*.md` files in one commit with no accompanying skills additions visible in that diff. Could be a straight purge (moving those workflows elsewhere entirely) rather than a 1:1 skills migration — **[unverified]** whether this is "commands→skills" or "commands→deleted."
- Roughly **2,328 repos** (Lens 3 proxy) still reference both `.claude/commands` and `.claude/skills` in their `CLAUDE.md`. This is ambiguous evidence — Anthropic's docs explicitly say old `commands/` files "keep working," so coexistence is at minimum partly inertia (no forcing function to migrate), not necessarily a considered decision to keep both. Cannot distinguish the two causes from this metric alone.

---

## Summary table

| Source | Task type / scope | Result | Numbers | Named failure modes / caveats |
|---|---|---|---|---|
| code.claude.com/docs/en/skills.md | vendor doc | commands merged into skills; old format still works; skills preferred for new work | none | vendor page, skews positive on its own migration |
| code.claude.com/docs/en/slash-commands.md | vendor doc | confirms page exists, adds `context: fork`, `disallowed-tools`, shell injection | none | — |
| learn.chatgpt.com/codex/reference/slash-commands | vendor doc | 3 surfaces converge on `/`: built-ins, custom prompts (`/prompts:<name>`), skills | none | — |
| github.com/openai/codex/releases 0.114–0.119 | vendor changelog | heavy skills investment; no confirmed commands/prompts removal at 0.117 | none | task brief's "0.117 removes slash commands" not found — flagged unverified |
| pi.dev/docs/latest/{prompt-templates,skills}.md + local `pi --help` | vendor doc + local ground truth | two separate directories/formats, actively documented, 2026 | none | strongest counter-evidence to "absorbed" framing |
| local `omp --help` | local ground truth | no `--prompt-template` flag; skills-only | none | omp is a pi fork that dropped the separate primitive |
| npmjs.com/package/@deepseek-ai/dsh | vendor doc | not reachable (403) | — | DSH commands-vs-skills status unconfirmed either way |
| opendatahub-io/ai-helpers PR #230 | practitioner (org) | full migration, cites vendor taxonomy change as reason | 8 commands → 8 skills | one anecdote |
| haacked/dotfiles PR #22 + follow-up | practitioner (named individual) | full migration, sustained 5+ months, `disable-model-invocation` substitutes for old command-only behavior | 5 commands → 5 skills, then more | one anecdote |
| gh code search (commands/skills paths) | in the wild, scale | skills corpus ~2x commands corpus by raw file-hit count | 222,208 vs 434,176 hits | not a repo-level ratio; includes forks/bots |
| gh commit search ("migrate commands to skills") | in the wild, adoption | migrations spanning Jan–Sep 2026, ongoing through the survey date | ≥20-30 distinct repos on first search page alone | not exhaustive; some propagated mechanically via shared tooling (rulesync) rather than independently decided |
| gh code search (CLAUDE.md mentions both paths) | in the wild, coexistence | thousands still reference both | 2,328 repos | ambiguous: could be inertia (old files "keep working") rather than a deliberate keep-both stance |

---

## Verdict

The vendor carrying the most weight for this five-harness config — Claude Code — has genuinely folded "commands" into "skills" as a file-format matter: `commands/*.md` and `skills/<name>/SKILL.md` produce byte-identical `/name` behavior, and the two invocation-control frontmatter fields (`disable-model-invocation`, `user-invocable`) reproduce every behavior a separate `commands/` directory used to buy — manual-only trigger, hidden-from-model, hidden-from-user. The in-the-wild evidence backs this up as an actual, ongoing 2026 practitioner trend (not just vendor marketing): migrations recur from January through September 2026, including one sustained example from a well-known individual practitioner (haacked) and one from an institutional open-source project (opendatahub-io) that explicitly cited Anthropic's "merged" framing as its reason.

But "skills absorbed commands" is **not** an industry-wide settled fact across the five target harnesses — it is true for Claude Code, plausibly true for Codex (all 2026 product investment is going into skills; the legacy `~/.codex/prompts` surface is small — ~4,280 code-search hits vs ~222k/434k for Claude's two paths — but not confirmed removed), and true for omp (which, as a pi fork, actively chose to drop the separate primitive it inherited). It is **false** for pi itself: pi maintains two separate, actively-documented, differently-discovered file formats in 2026, with a real behavioral difference (skills can auto-trigger from model judgment mid-conversation; prompt templates cannot). DSH's status could not be confirmed.

For a config that has to emit artifacts for all five harnesses: the honest empirical read is that the *target* format increasingly collapses to "skill file, tuned by frontmatter" for most harnesses, but pi's loader genuinely wants a separate prompt-template file on disk regardless of what the source repo's authoring convention is. That argues for keeping "command" as a distinct concept **at the source/authoring layer** — a thing tagged "user-invoked, no model auto-trigger, no supporting files" — even if the compiler step that emits per-harness output collapses that into a single skills file (with `disable-model-invocation: true`) for Claude Code, Codex, and omp, while still emitting a genuine separate prompt-template file for pi. Whether that source-layer distinction needs its own top-level directory (vs. e.g. a frontmatter tag inside one skills-shaped source tree, the pattern `ctoforaday/special-circumstances` used) is a design choice this survey doesn't settle — both patterns exist in the wild with concrete dates above.

---

## No precedent found

- No token/context-cost benchmark comparing a `commands/` directory's footprint against an equivalent `skills/` tree's footprint (auto-loaded description text specifically).
- No named individual's blog post (independent of a repo PR/commit) explicitly arguing to *keep* commands separate from skills in a 2026, multi-harness setup.
- No confirmation of the task brief's specific claim that Codex 0.117+ "removed slash commands" — nearest verified release notes (0.114.0–0.119.0) show sustained skills investment and one payload-cleanup chore (`#15906`, 0.118.0, "remove skill metadata from command approval payloads") that is adjacent but not equivalent to what was claimed.
- DSH's own commands-vs-skills story — source unreachable (403); local repo notes already record the `/model` command as "not found in the docs," i.e. this was already an open question before this survey and remains open.
- A repo-level (not file-hit-level) adoption ratio of commands-only vs skills-only vs both — not obtainable without a non-search-API crawl, which was out of scope for this pass.
