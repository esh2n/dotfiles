---
name: personal-tasks
description: "Manage the owner's own tasks (work and personal) in Taskwarrior 3.5 with the `task` CLI — not the agent's own TODO list. Use when the owner says 「タスクに入れて」「やること見せて」「今日何やる？」「終わった」「週次レビュー」, asks what is due or important, or mentions something they must do later (then suggest adding it in one line). Never for tracking the agent's own steps in a session."
metadata:
  namespaces: [work]
---

# personal-tasks — the owner's tasks in Taskwarrior

The owner keeps every task of their own, work and personal, in Taskwarrior
3.5 (`task`). Each machine holds a full replica and a background service
syncs it every five minutes; the phone syncs with the same server. The
structure below is the owner's ruling
(`harness/rules/decisions/2026-10-23-personal-tasks-sync.md`); keep to it
rather than inventing tags or projects.

These are the owner's tasks. Your own plan for the session goes in your own
todo tool, never here.

## Structure

- **project**: the top level is `work` or `personal` (family matters are
  `personal`). A second level exists only for a finite outcome with several
  steps — `personal.moving`, `work.auth-migration` — never for an area that
  never ends. A single task sits directly under `work` or `personal`.
  Run `task projects` and reuse an existing outcome before making one.
- **priority**: `H` means important; otherwise leave it empty. No M or L
  (the taskrc rejects them).
- **due**: a real deadline only — something breaks or someone waits if it
  passes. Due within 3 days shows as `+DUE`, past due as `+OVERDUE`; that is
  what "urgent" means here. A day to start on is `scheduled:`, a day to hide
  it until is `wait:`.
- **tags**: `+in` is the inbox (captured, not yet sorted); `+waiting` is
  waiting on someone else. Add no other tags without the owner asking.
- No estimates.

## Writing a task

- A task is one next action the owner can finish in one sitting and check
  off: 「レビューに返信する」, not 「返信して、CIを確かめて、draftを外す」.
  Something the owner only waits for (CI to pass, a reply) is not an action:
  fold it into the action that follows it, or tag it `+waiting`.
- Several steps toward one finite outcome (a pull request, a migration, a
  move) get a second-level project with one task per step, such as
  `project:work.pr-1234`. The descriptions then do not repeat the outcome's
  name.
- The description is one short line in the owner's own language, ending in
  the verb, the way the owner would write it on a note: 「レビューに返信する」.
  Follow the writing rules: no space between Japanese and Latin letters,
  digits or code, no parentheses packed with details, no symbols for words.
- Details go in an annotation, not the description: the URL, what is already
  done, why. Add the task, then `task project:<side> +LATEST annotate "<detail>"`.
- When proposing, show each task's project and description on its own line,
  with its annotations under it, so the owner can correct the split before
  anything is added.

## Views

| Command | Shows |
|---|---|
| `task now` | important and urgent |
| `task plan` | important, not urgent |
| `task quick` | urgent, not important |
| `task someday` | neither |
| `task in` | the inbox |
| `task next` | everything, by urgency |
| `task context work` / `task context personal` / `task context none` | limits reports and adds to one side (the owner's switch; see the machine limit below) |

Read with `rc.verbose=nothing` when you parse output, and `task <filter> export`
when you need fields exactly.

## What you may do

- **First, check this machine's limit**: `cat ~/.config/task/agent-context
  2>/dev/null`. If it names `work` or `personal`, only that side's tasks may
  reach you on this machine
  (`harness/rules/decisions/2026-10-23-tasks-agent-context.md`). Then:
  - Start every `task` command with the filter `project:<it>`, before any
    other filter, ID or UUID: `task project:work now`,
    `task project:work <uuid> info`, `task project:work <uuid> done`. The
    context alone is not enough: `export`, `info`, `modify`, `_get`,
    `_projects`, `_tags`, `ids`/`uuids` and any command given an ID or UUID
    ignore it, but a filter applies to every command.
  - Add only into that side: `task add project:<it>...`. If the owner asks
    to add or read the other side, say it is outside what you may touch here.
  - Use only these commands: the reports in Views (not `task context`),
    `projects`, `tags`, `info`, `export`, `add`, `done`, `modify`,
    `annotate`, `delete`. Never use `_get`, `_projects`, `_tags`, `_unique`,
    `_uuids`, `_ids`, `undo`, `import`, or `or`/`xor`/`not`/`!`/parentheses
    in a filter, never pass an `rc.` override other than `rc.verbose` and
    `rc.confirmation`, never set `TASKRC` or `TASKDATA`, and never read or
    write `~/.task` (its database or hooks) or the backups under
    `~/.local/state/task-sync`.
- **Read freely** within that limit: any report, `export`, `projects`, `tags`.
- **Add only after the owner says yes.** When the owner mentions something
  they must do, propose it in one line — description, project, and only the
  priority or due the owner actually stated — and add it when they agree.
  When the owner gives you the task outright (「〜をタスクに入れて」), that is
  the yes. Anything you cannot place goes in with `+in` and no project.
- **Never guess** `priority:H` or a `due`. If the owner did not say it is
  important or give a deadline, leave it out, or ask once.
- **Complete, delete, modify, or change several tasks at once** only after
  showing what will change and getting a yes; then run it with
  `rc.confirmation=no` so the prompt does not hang. Refer to tasks by UUID
  (`task <uuid> done`) rather than by ID, since IDs shift after every change.
- Do not run `task sync` yourself; the service syncs every five minutes, and
  `dotctl service restart task-sync` syncs now. Do not edit the taskrc.

## Weekly review

A recurring task "weekly review" (`recur:weekly`) reminds the owner. When
they start it, walk through these in order, one at a time, waiting for their
answer before changing anything:

1. `task in`: give each item a project, and priority or due only if the owner
   says so; remove `+in`.
2. `task +OVERDUE` and `task +DUE`: done, new real deadline, or dropped?
3. `task +waiting`: still waiting, or follow up?
4. Each second-level project (`task projects`): is the outcome finished, and
   does it still have a next step?
5. `task someday`: anything to delete or promote?

## Adding examples

```sh
task add project:personal "Renew the passport"            # no deadline given
task add project:work priority:H due:2026-10-30 "Submit the expense report"
task add project:personal.moving scheduled:monday "Ask three movers for a quote"
task add +in "Something about the dentist"                # not sorted yet

# three steps of one pull request: a second-level project, short lines,
# the details in annotations
task add project:work.pr-1234 "レビューに返信する"
task project:work +LATEST annotate "https://github.com/<org>/<repo>/pull/1234"
task project:work +LATEST annotate "2件は直した。残る1件は直さない理由を書く"
task add project:work.pr-1234 "結合テストをdevで流して結果をPRに書く"
task add project:work.pr-1234 "draftを外す"
task project:work +LATEST annotate "CIが通ってから"
```
