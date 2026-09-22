---
question: "Is the uncommitted apply-claude.ts / apply-guard.ts work in the harness-parity worktree consistent with main and with the accepted jig config-layout decisions, or does it need to be reworked or discarded?"
date: 2026-09-22
verdict: "apply-claude.ts implements a personal/core/packs layered composition that main's own apply-guard.ts explicitly calls 'a separate, rejected design', and that the accepted 2026-09-22-config-layout-no-personal-layer.md decision retires outright (no personal layer, no per-machine pack on/off). apply-guard.ts and to-claude-permissions.ts, by contrast, match the accepted decision's model exactly. main already committed and reverted the same apply-claude feature the same day, and this worktree's uncommitted version is a further regression on top of that reverted commit - it dropped the key-sorting canonicalization the reverted version had."
unverified:
  - "Whether a 3-way merge of the case-block insertion into cli/jig.ts's switch statement would auto-resolve, or needs manual reconciliation, given main added an unrelated box case at the same insertion point"
  - "Whether the projection-design-intent.md memo predates or is merely contemporaneous with the formal decision doc it anticipates"
  - "MCP servers, symlinked skills, and AGENTS.md were not tested against the four new files - out of scope for this investigation"
  - "No decision doc or explanation is attached to main's revert commit (6f6910c) itself, so the stated reason for the revert is not recorded anywhere"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# orphan apply-claude / apply-guard — investigation record (read-only)

Investigated: uncommitted work in worktree `harness-parity` (branch
`feat/jig-harness`, HEAD `a07df6797...` = exact merge-base with `main`, i.e.
`main` is 16 commits ahead, this branch has zero commits `main` lacks).

## 1. Provenance

### File mtimes (local, `+0900`)

| file | mtime |
|---|---|
| `src/app/apply/apply-claude.ts` | 2026-09-21 21:28 |
| `test/app/apply/apply-claude.test.ts` | 2026-09-21 21:31 |
| `test/app/apply/apply-claude-fixture.test.ts` | 2026-09-21 21:31 |
| `src/domain/policy/to-claude-permissions.ts` | 2026-09-22 00:19 |
| `test/domain/policy/to-claude-permissions.test.ts` | 2026-09-22 00:18 |
| `src/app/apply/apply-guard.ts` | 2026-09-22 00:19 |
| `test/app/apply/apply-guard.test.ts` | 2026-09-22 00:21 |
| `src/app/apply/apply-tiers.ts` (modified) | 2026-09-22 00:20 |
| `src/cli/apply.ts` (modified) | 2026-09-22 00:20 |
| `src/cli/jig.ts` (modified) | 2026-09-22 00:20 |

### Session that wrote them

`grep -l "apply-claude.ts" ~/.claude/projects/*/*.jsonl`:
- Main-checkout project dir (`-Users-esh2n-go-github-com-esh2n-dotfiles`): **no matches.**
- Worktree project dir
  (`-...--claude-worktrees-harness-parity`): 3 matches.
  - `4973e1e6-...jsonl` (36 lines, 2026-09-22T05:36:49–05:37:15Z) and
    `e32578c3-...jsonl` (36 lines, 2026-09-22T02:25:52–02:26:07Z): both are
    **compaction-summary requests** ("Below is a conversation log... Create a
    summary"), not the authoring session — `apply-claude.ts` appears only
    inside quoted prior-session summary text.
  - `aca170dd-8528-4110-b796-8805d4bf7908.jsonl` (22,976 lines,
    2026-09-19T14:33:27Z – 2026-09-22T06:30:14Z **and counting**): the real
    authoring session. First user message (2026-09-19T14:33:47Z, JST
    2026-09-19 23:33): "jig というもののハーネスを一から作ってもらっていて
    ... まずは内容を確認し、今の状況を私に説明してください" (a rebuild
    kickoff). This session's timestamp range fully covers all ten files'
    mtimes.
  - This session ID is the parent of the current investigation task's own
    scratchpad path — **it is, by construction, still running right now**
    (it dispatched this investigation).

## 2. What the code does

### `src/app/apply/apply-claude.ts` (new, untracked)

`applyClaudeSettings(paths, ports, write)`: reads `.claude-packs` (or falls
back to `packs.default`), then composes a full Claude Code `settings.json`
from three **`claude-profiles`** layers — `core/`, `packs/<name>/`,
`personal/` — each contributing `settings.layer.json` + `permissions.yaml` +
`mcp.json`. Uses `domain/compose/compose.ts`, `domain/permissions/*`,
`domain/mcp/*` (the pre-existing yoki-parity compose machinery). Diffs the
composed text against the real `~/.claude/settings.json` (after stripping
`.autoMode`). **Never writes** — `write: true` always returns `outcome:
"refused"`. Exports `parseEnabledPacks`.

Its own header comment: "read `.claude-packs`, compose settings.json from
the same core/packs/personal layers yoki-switch's `merge_settings()` reads
... Dry-run only, on purpose ... See .tmp-research/install-pipeline-plan.md
for the design this implements." **No mention of rejection or supersession
anywhere in this file.**

### `src/domain/policy/to-claude-permissions.ts` (new, untracked)

Pure function `toClaudePermissions(policy: Policy): ClaudePermissions`.
Projects the canonical `guard-rules.json` (`floor` + `rules`) onto Claude
Code's native `permissions.deny`/`allow` arrays: `shell.exec` with a literal
program alternation → `Bash(<prog> *)`; `fs.write`/`fs.edit` with a
recognized literal/glob path shape → `Write(<glob>)`/`Edit(<glob>)`.
Everything else (`effect: "ask"`, a raw `match` string, `net.fetch`,
`mcp.call`, unrecognized regex) is reported as `hookOnly` with a reason,
never guessed at. No I/O.

### `src/app/apply/apply-guard.ts` (new, untracked)

`applyGuard({paths, options}, ports)` — `jig apply-guard --target
<claude|pi|dsh|codex|all>`. For `claude`: reads **only**
`guard-rules.json`, calls `toClaudePermissions`, diffs the result against
the live `settings.json`'s `permissions.deny`/`allow` (never writes; message
lists generated deny/allow counts and the hook-only-dropped rules). For
`pi`/`dsh`: compares the deployed policy copy
(`resolvePolicyPath`/`JIG_POLICY_FILE`) against the repo's canonical
`guard-rules.json`, reports `noop`/`write`/`dest-missing`. For `codex`:
always a stub (`"native projection not yet defined"`).

Its own header comment explicitly states the two pipelines are deliberately
kept apart: "The ONLY input read for the `claude` target's conversion is
`guard-rules.json` itself ... never `permissions.yaml`, `settings.layer.json`,
`mcp.json`, `.claude-packs`, or any `domain/compose|permissions|mcp`
machinery (**that is a separate, rejected design** — see `apply-claude.ts`'s
own header for why it stays unwired from this pipeline)." — **but
`apply-claude.ts`'s header (written ~3h earlier, 21:28 vs. 00:19) contains no
such explanation.** `apply-claude.ts` was never updated to reflect whatever
rejection `apply-guard.ts` refers to.

### Wiring (`git diff -- cli/jig.ts cli/apply.ts app/apply/apply-tiers.ts`)

- `apply-tiers.ts`: `ApplyTarget` gains `"claude" | "codex"` tags (never
  added to `ALL_APPLY_TARGETS`, so they never run through the pi/dsh/litellm
  tiers.json loop — reused only for their `TargetResult` shape).
- `cli/apply.ts`: `applyCli` special-cases `--target claude` (single target
  only) to call `applyClaudeSettings` directly, always exit 0. Adds a whole
  second parser + `applyGuardCli` for `jig apply-guard --target <x>|all
  [--write]`, reusing `formatResult`/`TargetResult`.
- `cli/jig.ts`: adds `resolveClaudeApplyPaths()` (points at
  `domains/dev/config/claude-profiles/{core,packs,personal}` + real
  `~/.claude`) and `resolveGuardApplyPaths()` (points at the repo's
  `domains/dev/llm/harness/policy/guard-rules.json`, the deployed copy via
  `resolvePolicyPath`, and real `~/.claude/settings.json`); wires both into
  `main()`'s `apply` and new `apply-guard` cases; extends the usage string to
  document both — `claude` is described plainly, with no caveat, as
  "composes settings.json from claude-profiles' core/packs/personal layers
  (same layers yoki-switch reads) ... not part of `--target all` yet."

## 3. Relation to main

`git log --oneline main..feat/jig-harness`: **empty** (this worktree branch
has no commits `main` lacks — HEAD is `main`'s ancestor, not a diverged
branch).

`git log --oneline feat/jig-harness..main`: 16 commits, most relevantly (all
`+0900`):

```
cf0d75e 2026-09-21 17:38  feat(jig): fold yoki hook denies into guard policy
0524814 2026-09-21 19:18  feat(jig): route MCP edit tools through fs.edit
f1e5d49 2026-09-21 19:59  fix(jig): tag jev calls with a user-agent
964b7ad 2026-09-21 20:32  feat(jig): gate destructive infra MCP calls
a4b98dd 2026-09-21 21:06  feat(jig): gate destructive cloud/publish shell ops
ccbdece 2026-09-21 21:40  feat(jig): jig apply --target claude (dry-run)
6f6910c 2026-09-21 23:50  Revert "feat(jig): jig apply --target claude (dry-run)"
667c6ff 2026-09-22 12:27  feat(sbx): turn each harness's own sandbox back on inside the vm
da54875 2026-09-22 12:27  chore(gitignore): ignore yaml credential files
9c71733 2026-09-22 13:30  feat(jig): gate file reads of secrets (fs.read)
16f59e6 2026-09-22 13:46  chore(claude): disable the claude-mem plugin
66a0366 2026-09-22 14:16  docs(harness): add decision notes for jig design rulings
ebd1bd9 2026-09-22 14:16  docs(harness): state why each decision holds, not who said yes
ba9f746 2026-09-22 14:19  docs(harness): decide format-on-edit, gate-on-stop per harness
b508dd2 2026-09-22 14:20  docs(harness): state when a decision note is warranted
af5bbef 2026-09-22 14:23  docs(harness): decide the box shape for jig
2662837 2026-09-22 14:31  docs(harness): pi gate lives on agent_before_settle since 0.87.0
bfbdd3a 2026-09-22 14:34  docs(harness): tools come from the nix flake, box gets a linux subset
8df41d9 2026-09-22 14:35  feat(harness): research subagent definition (four-lens survey)
1b870cd 2026-09-22 15:26  feat(jig): box command and interactive entry
78e0c8c 2026-09-22 15:27  docs(harness): record what building the box established
```

**`main` already committed and then reverted this exact feature same
day**: `ccbdece` ("feat(jig): jig apply --target claude (dry-run)",
2026-09-21 21:40) added `apply-claude.ts` + wiring — same commit-message
description as the untracked file here — and `6f6910c` reverted it 2h10m
later (2026-09-21 23:50). No decision doc or explanation is attached to the
revert commit itself (`git show --format='%B' --no-patch 6f6910c` = just the
standard revert boilerplate).

`diff` of `main`'s reverted `ccbdece:apply-claude.ts` against the worktree's
current untracked `apply-claude.ts`: **near-identical**, one real
difference — `ccbdece`'s version recursively sorts object keys before
diffing (`sortKeysDeep`, to avoid jq-vs-jig key-order false diffs, per its
own commit message: "sorts object keys ... so it flags real changes, not
jq-vs-jig key-order noise"); the worktree's current version **dropped that
canonicalization** — only `.autoMode` is stripped, keys are left in
insertion order. This is a regression relative to the version `main` already
tried and reverted.

`apply-guard.ts` / `to-claude-permissions.ts` / their tests: `git log --all
--oneline -- '*apply-guard.ts' '*to-claude-permissions.ts'` = **empty** —
never existed anywhere in git history, on any branch. Wholly new, no revert
precedent.

### Grep for existing equivalents on `main`

`git ls-tree -r main --name-only -- domains/dev/llm/harness/jig/src | grep
-iE "apply-claude|apply-guard|to-claude-permissions|sandbox"` → **no
matches**. `main`'s `src/` has no committed equivalent of any of the four
new files today (the only trace is the reverted `ccbdece` commit, no longer
in the tree).

### Untracked research notes referenced by the code

`apply-claude.ts` cites `.tmp-research/install-pipeline-plan.md` (untracked,
152 lines, present in this worktree). `.tmp-research/projection-design-intent.md`
(untracked, 68 lines, dated 2026-09-22) is a design-reconciliation memo that
already flags this exact gap, calling it **"open decision #1"**: "`jig apply
--target claude` exists (`apply-claude.ts`) but ... composes a full
`settings.json` ... from **yoki-style layers** (`.claude-packs`,
`settings.layer.json`, `permissions.yaml`, `mcp.json` under
core/packs/personal) — see open decision #1, **this is not what either
design doc describes as the projection source**." This memo predates (or is
contemporaneous with) the formal decision doc below.

### Would the untracked files apply cleanly on top of `main`'s current `jig.ts`?

Concrete conflict surface (`git diff HEAD main -- .../cli/jig.ts`, since
`HEAD` = the exact base this worktree's uncommitted diff was made against,
and `main` = 16 commits ahead):

- Both diffs insert a new `case "..."` block into `main()`'s `switch`
  immediately after `case "apply":` — `main`'s `case "box":` vs. the
  worktree's `case "apply-guard":`. Same insertion point, would need manual
  reconciliation (not an auto-mergeable textual overlap, but adjacent enough
  that a 3-way merge tool would likely resolve it — a human still has to
  decide the order).
- Both diffs rewrite the same long usage-string literal at the end of the
  `default:` case — `main` appended a `box` paragraph and a `run with no
  arguments` paragraph; the worktree's diff appends `claude`/`apply-guard`
  paragraphs to the **old** (pre-box) string. This is a direct textual
  conflict: both sides edit overlapping lines of the same multi-line
  template string.
- `main` added a `default: {` block with new interactive-mode logic
  (`command === undefined && process.stdin.isTTY === true`) wrapping the
  same code region the worktree's diff also touches only for the usage
  string — not a logic conflict, but the block structure changed, so a
  naive patch/cherry-pick will not apply without `-3`/manual resolution.
  `apply.ts` and `apply-tiers.ts`'s diffs are unaffected by `main`'s box
  commits (no overlapping edits found in those two files' `main`-side
  history for this range).

## 4. Quality

### `bun test` (in `domains/dev/llm/harness/jig/`)

```
837 pass
11 fail
1889 expect() calls
Ran 848 tests across 67 files. [492.00ms]
```

All 11 failures are in `test/domain/policy/real-policy.test.ts`
("the real guard-rules.json — every rule, at least once"), e.g. `writing
.env.production asks` expected `"ask"`, received `"allow"`. This test file
is **not part of the uncommitted diff** (`git status --porcelain` shows no
modification) — it is a pre-existing, already-committed test at this
worktree's stale base commit (`a07df67`), failing because `main` has since
added policy rules this checkout doesn't have (`main`'s later commits
`9c71733` "gate file reads of secrets", `1eb6f4a` "ask on find -exec and
-delete", `288bd81` "migrate guard rules to v2" post-date this worktree's
`guard-rules.json`). **Unrelated to the four new files.**

Isolated run of just the four new test files:
`test/app/apply/apply-claude.test.ts` (11 tests),
`test/app/apply/apply-claude-fixture.test.ts` (1 test),
`test/app/apply/apply-guard.test.ts` (18 tests),
`test/domain/policy/to-claude-permissions.test.ts` (15 tests) — actual
totals from the run: **45 pass, 0 fail, 148 expect() calls across 4
files.**

### `bunx tsc --noEmit`

No output — clean.

### Hygiene grep (new/modified files + their tests)

`console.log`, `: any`, `as any`, `TODO`, `FIXME`: **none found.**
Hardcoded absolute paths / usernames (`/Users/`, `esh2n`): **none found**
(all paths are parameterized via `ClaudeApplyPaths`/`GuardApplyPaths`
interfaces, populated from `homedir()`/`process.env` in `jig.ts`, or are
test-fixture placeholder paths like `/claude/.claude-packs`).

## 5. Fit against the rulings

Read: `2026-09-22-config-layout-no-personal-layer.md` and
`2026-09-22-box-shape.md` (both `Status: accepted`, committed on `main` at
2026-09-22 14:16 / 15:27 +0900 — **after** every one of the ten files under
review here was last written, 00:21 +0900 at the latest).

### `2026-09-22-config-layout-no-personal-layer.md`

- **Decision**: "personal 層は作らない。jig はユーザー一人の層なので、個人
  のスキルもルールも同じ場所に置く" (no personal layer; jig is single-user,
  so personal and shared config live in the same place).
  → **Disagrees**: `apply-claude.ts` reads `paths.personalDir` as a
  distinct third layer (`settings.personal.json`, `permissions.yaml`,
  `mcp.json`) composed after `core`/`packs`, with its own test asserting
  "personal wins scalar keys, hooks concat personal-first" — i.e. it
  actively implements the exact personal/core split the decision retires.
- **Decision**: "機械ごとの on/off(packs)はやめる" (stop per-machine
  pack on/off).
  → **Disagrees**: `parseEnabledPacks`/`resolveEnabledPacks` read
  `.claude-packs` (falling back to `packs.default`) and gate which
  `packs/<name>/` layers are composed — exactly the on/off mechanism being
  retired.
- **Decision**: config sources should live under `domains/dev/llm/harness/`
  by kind (`rules/`, `skills/`, `agents/`, `hooks/`, `mcp/`, `policy/`,
  `jig/`), with `policy/` (`guard-rules.json`) as the one already-built
  example.
  → `apply-claude.ts` reads from `domains/dev/config/claude-profiles/`
  (`core/packs/personal`) — the pre-existing yoki-profile layout, not the
  decision's target layout. (Factually, `domains/dev/llm/harness/` in this
  worktree today contains only `jig/` and `policy/` — the `rules/` etc.
  split doesn't exist yet in this checkout either way.)
  → `apply-guard.ts`/`to-claude-permissions.ts` read only
  `domains/dev/llm/harness/policy/guard-rules.json` — **matches** the
  decision's model exactly (one canonical source under `harness/`, per-kind,
  translated per-harness by the generator). The decision's own "翻訳が要る
  もの" (things needing translation) list explicitly names "権限
  (guard-rules.json から四つの形)" (permissions, four forms from
  guard-rules.json) — this is precisely what `to-claude-permissions.ts`
  implements.
- Not applicable / not tested: MCP servers, symlinked skills, AGENTS.md —
  outside scope of these four files.

### `2026-09-22-box-shape.md`

- Not applicable to either file: neither touches `sbx`/box/microVM
  concerns, container cloning, credential injection, or session resume. No
  agreement or disagreement to report.
- Neither file writes a `sandbox.enabled`/`sandbox.*` key anywhere;
  `sandbox` does not appear in `domain/compose/*.ts` or in
  `claude-profiles/core/settings.layer.json` (grepped, no matches) — the
  composed output would only carry a `sandbox` key if one of the layer
  source files defined it, which none currently do.

## Cross-cutting note

`apply-guard.ts`'s own code comment (written ~00:19, the same batch as the
`cli/jig.ts`/`cli/apply.ts` wiring at 00:20) already calls the
`apply-claude.ts` personal/packs design "a separate, rejected design" —
i.e. the authoring session had, by its own account, concluded this before
writing the uncommitted diff that wires `jig apply --target claude` into
the live CLI's `main()` and usage text as a normal, unflagged, working
target ("composes settings.json from claude-profiles' core/packs/personal
layers ... not part of `--target all` yet" — no caveat about rejection or
supersession). `apply-claude.ts` itself was never edited to add any such
caveat (its header is unchanged since 21:28, three hours before
`apply-guard.ts` called the same design "rejected"). This tension exists
inside the uncommitted diff itself, independent of anything on `main`.
