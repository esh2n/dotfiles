---
name: pstack-adapter
description: Read once per session before following any pstack skill (poteto-mode, its playbooks, the principle-* skills, and the rest of the pack). pstack is written for Cursor; this maps its tool names, subagent fields, model slugs, paths and Cursor-only features to Claude Code, Codex, pi and omp.
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

There are no Cursor Automations (routines, `update_state`, `api2.cursor.sh/automations` webhooks, `SendToUser`), Bugbot or Cursor cloud agents here. When a step needs one, write one line, `Skipped here: <step>. <reason>.`, and go on to the next step; leave a named placeholder when a later step needs what the skipped one made. Bugbot comments on a GitHub pull request are ordinary review threads. A built-in PR tool maps to `gh pr create`, but the house rules still hold: no pull request without the user's instruction, and never a merge.
