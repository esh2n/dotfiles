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
| `poteto-agent`, `comment-sicko` | The agents of the same name (Claude Code and omp). Where there is no such agent, brief a default subagent to read `<pack>/agents/<name>.md` first. |
| `readonly: true` | Claude Code: `subagent_type: "Explore"`. Everywhere: the brief says "do not edit files", and you check `git status` afterward. |
| `readonly: false` | The default subagent type. |
| `environment: "cloud"` | A worktree at `.claude/worktrees/<name>` on a branch `<name>`, the house layout. Name the branch or commit the worker checks out. |
| `environment: "local"` | Omit. |
| `cloud_base_branch: <b>` | Tell the worker to check out `<b>` first. |
| `run_in_background: true` | Omit; use the harness's default. |
| `resume` | Spawn a new agent and paste the earlier result into its brief. |
| `file_attachments` | List the paths in the brief. |

## Models

Pick no model from a pstack slug. Claude Code subagents may take `model: opus`, `sonnet`, `haiku` or `fable` with an `effort` when the skill asks for a stronger or cheaper role: a slug `claude-<family>-<version>-<effort>[-fast]` such as `claude-opus-5-5-xhigh`, or a role value `<model> <effort>` such as `opus high`, maps to that family and effort; drop `-fast`. A `grok-*`, `gpt-*` or other non-Claude slug, `auto` and `inherit-parent` mean omit the model. In Codex, pi and omp, omit every model field: the session keeps its tier, and a stronger model is reached through a subagent whose tier says so (house rule). `setup-pstack` and `pstack-models.mdc` (`~/.cursor/rules/pstack-models.mdc`) have nothing to write here: say so and go on.

## Review

Outside a pstack task, reviews go through the house `change-review` skill. Inside one, pstack's review steps (`interrogate`, `no-comments`, `shipping`, the audit lanes) stay, with these mappings. The `change-review` skill's step 6 runs `interrogate` the same way.

- **Reviewer B runs on a different model family.** This replaces the Models rule (omit non-Claude slugs) for interrogate's Reviewer B only; the model diversity is the point of interrogate. Reviewer A runs as the Models section says.
  - Claude Code: Reviewer B is one delegation to Codex. Write the filled reviewer prompt to a temp file, run `codex exec --sandbox read-only --ephemeral -o <out-file> - < <prompt-file>` from the repository root, and read `<out-file>` as Reviewer B's answer. Set Reviewer A's `model` explicitly, because a `readonly` reviewer mapped to `Explore` may otherwise take that type's default model.
  - omp, pi, DSH: run Reviewer B on a tier whose model is from a different family than the session's (the tier's `use` ids in `harness/policy/tiers.json`, their provider in `harness/policy/models.json`). `executor` does not count: review is not machine-checkable work. When no tier qualifies, make the same single `codex exec` delegation as Claude Code.
  - Codex: no second family is in reach without `claude -p`, which the house does not use. Write `Skipped here: second-family review. No other family reachable from Codex.` and run Reviewer B on the session's model.
  - Never put security-reviewer's findings in the prompt sent to another provider; send the diff, the intent and the context files only.
- **Attach the house knowledge as context files.** interrogate Step 1 packages "surrounding context files the reviewers need"; fill `{DIFF_OR_FILES}` with the diff plus the changed language's `references/review-standard.md` (or the language skills in the `change-review` skill's `references/language-map.md`) and the domain checklists for what the diff touches.
- **Lead judgment into the house report.** Act on → findings, each checked by `review-verifier` before it is reported; Consider → questions for the owner; Noted → one line under Ran; Dismissed → the refuted count with reasons. The report follows the `change-review` skill's `references/output-format.md`, and nothing goes to GitHub without the owner's approval.
- **Audit lanes and `shipping` verifiers.** When a playbook asks for audit lanes with distinct viewpoints, use the house reviewers as the lanes: `code-reviewer`, `security-reviewer`, `workload-reviewer`, `test-reviewer`, and `ui-reviewer` for visual changes.

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

The table in the always-on rules (the pstack section of `AGENTS.md`) names where the house wins over pstack's text. This section gives each row's reason and details. Outside these rows a pstack task follows its playbook. Each row's pstack quote is recorded, with its file, in the dotfiles repository's `harness/plugins/pstack/precedence.json`; when an upgrade rewrites a quoted line, the row is due for a fresh look, and until then follow the row.

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

pstack: "explicit model per role (configurable via `/setup-pstack`." (`poteto-mode/SKILL.md`, Subagents). The Models section above already covers this: take the role's strength from the slug, never the slug itself. `setup-pstack` has nothing to write.

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
