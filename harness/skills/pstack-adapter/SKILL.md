---
name: pstack-adapter
description: Read once per session before following any pstack skill (poteto-mode, its playbooks, the principle-* skills, and the rest of the pack). pstack is written for Cursor; this maps its tool names, subagent fields, model slugs, paths and Cursor-only features to Claude Code, Codex, pi and omp, and gives the details of the house overrides.
---

# Following pstack outside Cursor

pstack skills name Cursor's tools. Read this once per session, then map each Cursor name with the tables below. If a Cursor field has no row, drop it and say so. Never pass a field or value your tool schema rejects.

`<pack>` is the pack checkout: `~/.local/share/jig/plugins/pstack/pstack` (`$XDG_DATA_HOME/jig/plugins/pstack/pstack` when that is set). `<skills>` is where your harness reads skills: `~/.claude/skills` in Claude Code, `~/.agents/skills` in Codex, pi and omp. pstack's skills and its two agents are linked there beside the house's own.

## Tools

| Cursor | Claude Code | Codex, pi, omp |
| --- | --- | --- |
| `Task` | `Agent` | omp: `task`. Codex and pi: your subagent tool if the session offers one; otherwise do the work yourself in this session and say the step ran without a subagent. |
| `AskQuestion` | `AskUserQuestion` (absent in `-p` mode: ask in plain text) | Your question tool if the session offers one; otherwise ask in plain text and stop for the answer. |
| Open a todolist | `TodoWrite` | Your todo tool if the session offers one; otherwise keep the list in your reply and update it at each phase. |
| Run another pstack skill (`/name`, "the **name** skill") | Read `<skills>/<name>/SKILL.md` and follow it. To tell the user to type it, write `/name`. | Read `<skills>/<name>/SKILL.md` and follow it. To tell the user: pi `/skill:name`, omp `/name`, Codex by mentioning the skill name. |
| `Grep`, `Glob`, `Shell` | The session's search tools, or `Bash` with `rg` and `fd`. | The shell tool with `rg` and `fd`. |

## Subagent fields

| Cursor | Everywhere |
| --- | --- |
| `subagent_type: generalPurpose` | The default subagent type (Claude Code: `general-purpose`). |
| `comment-sicko` | The agent of the same name (Claude Code and omp). Where there is no such agent, brief a default subagent to read `<pack>/agents/comment-sicko.md` first. |
| `poteto-agent` | Not used for implementation: see Overrides, "Subagent type" and "Who implements". |
| `readonly: true` | Claude Code: `subagent_type: "Explore"`. Everywhere: the brief says "do not edit files", and you check `git status` afterward. |
| `readonly: false` | The default subagent type. |
| `environment: "cloud"` | A worktree at `.claude/worktrees/<name>` on a branch `<name>`, the house layout. Name the branch or commit the worker checks out. |
| `environment: "local"` | Omit. |
| `cloud_base_branch: <b>` | Tell the worker to check out `<b>` first. |
| `run_in_background: true` | Omit; use the harness's default. |
| `resume` | Spawn a new agent and paste the earlier result into its brief. |
| `file_attachments` | List the paths in the brief. |

## Models

Pick no model from a pstack slug. Choose the tier and effort from the house's model table (`rules/common/60-delegation.md`, `rules/decisions/2026-10-19-model-assignment.md`) by the kind of work the step does: design and planning on `complex` at xhigh, hard debugging and reviews at high, exploration and carrying out a fixed plan at medium, implementation inheriting the session. The house table was built on pstack's own approach, so the two mostly agree; where a pstack role asks for more (xhigh for code delegates, raising to max), follow the house. In Claude Code that means `model: opus`, `sonnet`, `haiku` or `fable` with an `effort`; drop `-fast`. A `grok-*`, `gpt-*` or other non-Claude slug, `auto` and `inherit-parent` mean omit the model. When a model is unavailable, never continue on a different one: stop and report which failed and why. In Codex, pi and omp, omit every model field: the session keeps its tier, and a stronger model is reached through a subagent whose tier says so (house rule). `setup-pstack` and `pstack-models.mdc` (`~/.cursor/rules/pstack-models.mdc`) have nothing to write here: say so and go on.

## Review

Every review goes through the house `change-review` skill, in a pstack task too (`rules/decisions/2026-10-19-pstack-house-wins-on-conflict.md`). Where a playbook says to run `interrogate`, run audit lanes, or verify a PR before shipping, run `change-review` instead; its step 6 runs `interrogate` as the heavy second review with these mappings. `no-comments` may still run on the diff before the review.

- **Reviewer B runs on a model at least as strong as the session's, never weaker** (`rules/decisions/2026-10-19-second-review-model.md`). A weaker second reviewer breaks correct work more often than it fixes it. This replaces the Models rule (omit non-Claude slugs) for interrogate's Reviewer B only. Reviewer A runs as the Models section says.
  - Claude Code: Reviewer B is one delegation to Codex's strongest model. Write the filled reviewer prompt to a temp file, run `codex exec -m gpt-6-sol -c model_reasoning_effort=high --sandbox read-only --ephemeral -o <out-file> - < <prompt-file>` from the repository root (the model is the `complex` row of `agents/models.json`'s `codex` table), and read `<out-file>` as Reviewer B's answer. Set Reviewer A's `model` explicitly, because a `readonly` reviewer mapped to `Explore` may otherwise take that type's default model.
  - omp, pi, DSH: the session runs DeepSeek, so make the same single `codex exec` delegation as Claude Code; Codex's strongest model is stronger than the session's. Never use another LiteLLM tier or `executor` for Reviewer B.
  - Codex: Claude is reachable only through `claude -p`, which the house does not use, and every other model in reach is weaker. Run Reviewer B as a fresh session of the same model (a new subagent with no shared context), and say so in the report.
  - When Codex's usage limit is near or a delegation fails: skip Reviewer B and write `Skipped: second review (<reason>).` in the report. Never fall back to a weaker model.
- **Attach the house knowledge as context files.** interrogate Step 1 packages "surrounding context files the reviewers need"; fill `{DIFF_OR_FILES}` with the diff plus the changed language's `references/review-standard.md` (or the language skills in the `change-review` skill's `references/language-map.md`) and the domain checklists for what the diff touches.
- **Lead judgment into the house report.** Act on → findings, each checked by `review-verifier` before it is reported; Consider → questions for the owner; Noted → one line under Ran; Dismissed → the refuted count with reasons. The report follows the `change-review` skill's `references/output-format.md`, and nothing goes to GitHub without the owner's approval.
- **Audit lanes and `shipping` verifiers.** When a playbook asks for audit lanes with distinct viewpoints, use the house reviewers as the lanes: `code-reviewer`, `security-reviewer`, `workload-reviewer`, `test-reviewer`, `spec-reviewer`, `rollout-reviewer`, and `ui-reviewer` for visual changes.

## Paths

| Cursor | Here |
| --- | --- |
| `.cursor/skills/`, `~/.cursor/skills/` | `<skills>` |
| `~/.cursor/plugins/`, `.cursor-plugin/plugin.json` | `<pack>`, `<pack>/plugin.json` |
| `.cursor/rules/*.mdc`, always-applied rules | `AGENTS.md` (Claude Code reads it through `CLAUDE.md`). |
| `https://github.com/cursor/plugins/blob/main/pstack/<path>` | `<pack>/<path>` when the file exists. Read the local copy; give the user the URL when they need a link. |
| A relative link that climbs out of a skill (`../../docs/guide/…`, `../../README.md`) | Resolve it from `<pack>/skills/<skill>/`. The skill under `<skills>` is a link, so `<skills>/<skill>/../../docs` names a path that does not exist. |
| `pstack/<path>` in a command, e.g. `node pstack/skills/poteto-mode/scripts/check-plan.mjs` | `<pack>/<path>` |
| `~/.cursor/projects/<slug>/agent-transcripts/` | Claude Code: `~/.claude/projects/<slug>/<session>.jsonl`, where the slug is the workspace path with each `/` and `.` changed to `-`. Elsewhere: say transcripts are not available and go on. |

## Cursor-only features

There are no Cursor Automations (routines, `update_state`, `api2.cursor.sh/automations` webhooks, `SendToUser`), Bugbot or Cursor cloud agents here. When a step needs one, write one line, `Skipped here: <step>. <reason>.`, and go on to the next step; leave a named placeholder when a later step needs what the skipped one made. Bugbot comments on a GitHub pull request are ordinary review threads. A built-in PR tool maps to `gh pr create`; the pr-readiness and merge overrides below decide draft or ready, and never a merge.

## Overrides

Wherever pstack and the house disagree, the house wins, in a pstack task too (`rules/decisions/2026-10-19-pstack-house-wins-on-conflict.md`); pstack only adds what the house lacks. The table in the always-on rules (the pstack section of `AGENTS.md`) lists the main conflicts; this section gives each row's reason and details, and "Other known conflicts" below covers the rest. A conflict not listed anywhere is still settled for the house: do the house's step and say in the reply which pstack step you replaced. Each row's pstack quote is recorded, with its file, in the dotfiles repository's `harness/plugins/pstack/precedence.json`; when an upgrade rewrites a quoted line, the row is due for a fresh look, and until then follow the row.

### pr-readiness

pstack: "Open every PR ready, never as a draft." (`poteto-mode/playbooks/opening-a-pr.md`), repeated in `multi-phase-plan.md`.

A personal repository is one under a path prefix in `~/.config/jig/policy/main-push-allowed`, the owner's per-machine list the guard already reads for main pushes. Compare the session's working directory with each prefix (`~` expands to the home directory); a missing or unreadable file means not personal.

- Personal repository: follow pstack, open the PR ready. Working on main is allowed there.
- Anywhere else: open the PR with `gh pr create --draft`. A draft means "do not review yet". Do your own review of the full diff (`git diff <base>...HEAD`) and run the checks the playbook asks for, then `gh pr ready <number>`. Run `gh pr view <number>` before you report PR status.

Opening a PR at the end of a playbook needs no instruction from the user.

### outward-writes

pstack: "Reversible work and external actions (team chat, ticket updates, kicking off evals) proceed without asking." (`poteto-mode/SKILL.md`, Autonomy), and reflect's "File each Backlog item to your team's devex or backlog tracker without waiting."

Reading and local work through MCP tools needs no question: search, fetch, read a page or a design, run a local tool. Before any write other people can see, ask the owner and wait: posting to team chat, creating or updating a ticket, writing or commenting on a Notion page or a shared document, sending mail or a calendar invite. Name the target and show the text you would write. Under a full-autonomy grant, draft the write and report it instead of sending it. Writes to the user's own repository through git and `gh` follow the git rules, not this row.

### model-slugs

pstack: "explicit model per role (configurable via `/setup-pstack`." (`poteto-mode/SKILL.md`, Subagents). The Models section above covers this: the house table picks tier and effort by the kind of work, never the slug. `setup-pstack` has nothing to write.

### planning

pstack: "i don't believe in planning. the best spec is code." (`README.md`), and the routes that make `how`, `architect` and `multi-phase-plan` the planning step. Plan by size as the house does (`rules/decisions/2026-09-23-plan-by-size-grill-default.md`): no plan when the diff fits one sentence, the `grilling` skill when it spans files or the method is uncertain, `sdd` only for large, ambiguous, multi-file work. `how` and `architect` may still be used to read the code or sketch types inside that plan; they do not replace it.

### stop-conditions

pstack: "Proceed, then present." (`principle-never-block-on-the-human`), and "Reserve the question for a genuine product or preference call no experiment can settle." (`poteto-mode/SKILL.md`).

These agree with the house's execution rules on most points: do not ask about reversible work, settle a fact by running something, and stop for a product or preference call. The house adds one stop. An accepted decision note (`harness/rules/decisions/` in the dotfiles repository, or a project's own) or an always-on house rule records the owner's ruling. A change that would contradict or supersede one is the owner's call: stop and ask, one question at the end of the turn. Do not read the owner's passing remarks as rulings.

### worktrees

pstack: worktree-cleanup's "Per path, `git worktree remove --force <path>`." and "`rm -rf` it, then `git worktree prune`", and the Claude Code mapping of `environment: "cloud"` to `isolation: "worktree"`.

- A worktree is `.claude/worktrees/<name>` on a branch `<name>`, made with plain git and ignored through the repository's `info/exclude`; never a harness's own isolation form (the `environment: "cloud"` row above).
- In the cleanup playbook, remove only worktrees that are clean, merged and not in use, with `git worktree remove <path>` and no `--force`. Never `rm -rf` a worktree path. A worktree with uncommitted, untracked or ignored files stays; list it with the reason. Merging a worktree branch back is the owner's step.

### merge

pstack: Shipping's "landing the contiguous verified run bottom-up through `gh` by default", and the merge steps of autopilot-full. Never merge a pull request or force-push. Where a playbook says to land or merge, stop at merge-ready (checks green, review threads answered), report it, and hand it to the owner.

### missing-skills

pstack names skills that are not installed here: `deslop` and `control-cli` / `control-ui` (from Cursor's `cursor-team-kit`) and `create-skill` (built into Cursor). Do not stop on them; use the substitute and say which one ran.

| pstack names | Use |
| --- | --- |
| `deslop` (before commit) | pstack's own `no-comments` skill on the diff, then a review of the diff for leftover debug code, dead branches and needless defensive checks. In Claude Code, the `code-reviewer` agent or the `simplify` skill. |
| `control-cli` | Drive the CLI or TUI through the shell yourself and capture its output. In Claude Code, the `run` skill. |
| `control-ui` | Codex, pi and omp: the `playwright` MCP server. Claude Code: the `run` or `claude-in-chrome` skill. Screenshots for a PR: the `ui-capture` skill. |
| `create-skill` | Claude Code: Anthropic's `skill-creator`. Codex: its built-in Skill Creator. pi and omp: write the SKILL.md by hand (frontmatter `name` and `description`, English), then test it with the `empirical-prompt-tuning` skill. |

### pack-edits

pstack: reflect's "Trivial existing-skill edit (…): the parent does it directly.", automate-me's default `.cursor/skills/<handle>-mode/SKILL.md`, and correct's "When the operator corrects you, fix the mistake and add the rule."

Every `make up` resets `<pack>` to upstream (`checkout -f` and `git clean`), and `<skills>` holds links jig owns. An edit made in either place is lost or overwritten. Route each accepted change instead:

- A change to how the house works: an existing house skill under `harness/skills/<name>/` in the dotfiles repository, or a new one there. Do not take a name pstack already uses, or a short generic one (`how`, `why`, `tdd`, `swarm`).
- An always-on rule: one line in `harness/rules/common/`. A ruling the owner made: a decision note in `harness/rules/decisions/`.
- Anything a machine can check: a lint or test. A guard rule lives in `policy/guard-rules.json`, which agents cannot write; propose the rule to the owner.
- automate-me's mode skill: `harness/skills/<handle>-mode/SKILL.md`, referencing house and pstack skills by name rather than pasting them.
- correct's rule table: in the dotfiles repository, the generated `AGENTS.md` is not committed, so the table goes in `harness/rules/common/`. In any other project, that project's own instruction file.
- A defect in pstack itself: report it to the user for an upstream issue; do not patch the pack. If the latest pack is broken, the owner pins `commit` in `harness/plugins/pstack/source.json`.

reflect's backlog filing is an outward write (outward-writes above).

### Not a conflict: tests

pstack's tdd skill prefers no new test over a bad test; the house requires 80% coverage. Both hold. Reach coverage with tests of behaviour, and never pad it with a test that still passes when the behaviour breaks.

### Other known conflicts

Each line names the pstack step and the house step that runs in its place.

- **Who implements** (Feature, Bug fix, Refactoring, Perf issue: "Delegate code-writing to a subagent", arena for implementations). Implementation that needs design judgment stays in the session; a subagent gets only read-and-report work or a fully specified step whose result a test, lint or type check confirms, and never two writers on one file (`rules/decisions/2026-09-22-subagents-and-workflows-by-scale.md`). Skip arena for implementation and say so.
- **Subagent type** ("Use `subagent_type: "poteto-agent"`"). Spawn the house agent for the kind of work (`rules/common/60-delegation.md`: architect, research, docs-lookup, build-error-resolver, the review agents); otherwise the default subagent type.
- **Basis for a design** (prototype or 2-3 prototypes decide a fork). Before proposing a design, gather the four-lens research record with a URL per claim (`rules/decisions/2026-09-22-research-four-lenses.md`), and search existing implementations and registries first (`rules/common/20-execution.md`). A prototype may add measured evidence; it does not replace the research.
- **When to ask** ("Reserve the question for a genuine product or preference call"). Also stop for a blocking error, a design decision that needs the owner, or an ambiguous requirement (`rules/common/20-execution.md`), one question at the end of the turn.
- **Bug fix stop point** (keep going until a dead end). After three failed fixes, stop and discuss with the owner (`systematic-debugging`); a bug that survived two attempts goes to a `complex` agent (`rules/common/60-delegation.md`).
- **Tests** (Bug fix commits the failing repro first; tdd only when cheap). Write tests first for features, fixes and refactors (`tdd-workflow`, `rules/common/50-quality-and-testing.md`), but never commit with failing tests (`rules/common/30-security.md`): commit the test together with the fix.
- **Prototype** (no tests, quality ignored). Allowed only in a scratch directory outside the repository; anything that lands in the repository follows the quality rules.
- **Code style** (inline one-caller wrappers). The house coding style holds (`rules/common/50-quality-and-testing.md`).
- **Parallel workers** (ten live lanes per PR, about ten children in flight). Three to five workers (`rules/decisions/2026-10-19-swarm-on-native-subagents.md`).
- **Worktree by default** (Opening a PR: work from a worktree, `git reset --hard` between tasks). Work in the current checkout; isolate only for parallel writers, with the `using-git-worktrees` skill (`rules/decisions/2026-09-27-one-worktree-layout.md`). `git reset --hard` is forbidden by the guard.
- **Unattended runs** (Cursor's `/loop`, `/loop 1h`, Autonomous run's "a plateau is not a stop"). Use the harness's native goal feature only, with a machine-checkable success condition, and deliver no more than the launch named (`rules/decisions/2026-09-22-loop-native-goal.md`). Never start `/loop`.
- **Run state** (Orchestrate's store outside the repository). Keep the run's record in the repository's plan files (`plans/` in the dotfiles repository) or decision notes (`rules/decisions/2026-09-22-memory-files-only.md`).
- **Answer shape** (`how` and Investigation open with Key Concepts). No glossary or prerequisites block up front; explain each term where it first appears (`rules/common/90-writing.md`).
- **Perf delivery** (Perf issue and Hillclimb open a PR). For Go, report by default and commit only when asked (`go-performance`).
- **Pausing** (Pause safely: a `wip:` commit, even on a broken tree). Leave the work uncommitted and write the resume note; commit only a passing tree in the house commit format (`rules/common/10-git.md`).
- **PR text** (Opening a PR's sections and rebased history). Follow the house PR rules: summary and a test-plan checklist from the full history, never rewrite pushed history (`rules/common/10-git.md`).
- **GitHub posts** (Babysit replies and resolves threads, Shipping posts verdicts). Show the text and get the owner's approval before any post, reply or thread resolution (`rules/common/60-delegation.md`).
- **Risky commits.** Before a commit touching auth, input handling, secrets, CI or dependencies, wait for `security-reviewer` through `change-review` (`rules/common/60-delegation.md`).
