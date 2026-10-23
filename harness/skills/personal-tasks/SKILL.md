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
  Run `task _projects` and reuse an existing outcome before making one.
- **priority**: `H` means important; otherwise leave it empty. No M or L
  (the taskrc rejects them).
- **due**: a real deadline only — something breaks or someone waits if it
  passes. Due within 3 days shows as `+DUE`, past due as `+OVERDUE`; that is
  what "urgent" means here. A day to start on is `scheduled:`, a day to hide
  it until is `wait:`.
- **tags**: `+in` is the inbox (captured, not yet sorted); `+waiting` is
  waiting on someone else. Add no other tags without the owner asking.
- No estimates.

## Views

| Command | Shows |
|---|---|
| `task now` | important and urgent |
| `task plan` | important, not urgent |
| `task quick` | urgent, not important |
| `task someday` | neither |
| `task in` | the inbox |
| `task next` | everything, by urgency |
| `task context work` / `task context personal` / `task context none` | limits every read and add to one side |

Read with `rc.verbose=nothing` when you parse output, and `task <filter> export`
when you need fields exactly.

## What you may do

- **Read freely**: any report, `export`, `_projects`, `_tags`.
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
4. Each second-level project (`task _projects`): is the outcome finished, and
   does it still have a next step?
5. `task someday`: anything to delete or promote?

## Adding examples

```sh
task add project:personal "Renew the passport"            # no deadline given
task add project:work priority:H due:2026-10-30 "Submit the expense report"
task add project:personal.moving scheduled:monday "Ask three movers for a quote"
task add +in "Something about the dentist"                # not sorted yet
```
