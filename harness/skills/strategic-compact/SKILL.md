---
name: strategic-compact
description: Suggests manual context compaction at logical task boundaries (research→plan, milestone→next phase) instead of arbitrary auto-compaction. Use when a long session approaches context limits, when switching phases or tasks, or when deciding whether /compact would lose important context.
origin: ECC (restored 2026-08-05; the hook that measured context size retired with the previous harness on 2026-09-23 — this skill is advisory only)
metadata:
  namespaces: [agent]
---

# Strategic Compact Skill

Suggests manual `/compact` at strategic points in your workflow rather than relying on arbitrary auto-compaction.

## When to Activate

- Running long sessions that approach context limits
- Working on multi-phase tasks (research → plan → implement → test)
- Switching between unrelated tasks within the same session
- After completing a major milestone and starting new work
- When responses slow down or become less coherent (context pressure)

## Why Strategic Compaction?

Auto-compaction triggers at arbitrary points:
- Often mid-task, losing important context
- No awareness of logical task boundaries
- Can interrupt complex multi-step operations

Strategic compaction at logical boundaries:
- **After exploration, before execution** — Compact research context, keep implementation plan
- **After completing a milestone** — Fresh start for next phase
- **Before major context shifts** — Clear exploration context before different task

## How the decision is made

There is no hook behind this skill. The harness registers exactly five hooks
(guard, session record, skill selection, format on edit, gate on stop —
`rules/decisions/2026-09-22-hooks-five-events.md`), and none of them counts
tokens or nags about `/compact`. The signals are yours to read:

- the harness's own context indicator, where it has one (Claude Code shows the
  percentage of the window used)
- the phase you are in (the table below)
- the size of what you just read: a few large file reads or a long tool
  output fill a window faster than many small edits

## Before You Compact — Checklist

1. **Write state down first** — anything you'll need next phase goes into a
   file, the task list, or memory *before* compacting: decisions made, file
   paths in flight, the next 3 steps
2. **Compact with a directive** — `/compact Focus on implementing auth
   middleware next` beats a bare `/compact`; the summary keeps what you name
3. **Check the boundary** — mid-implementation state (variable names, partial
   edits, half-done refactors) does not survive well; finish or checkpoint first

## Compaction Decision Guide

The short version of this table lives in the always-on core rules
(AGENTS.md "Compaction Timing"); this is the full reasoning.

| Phase Transition | Compact? | Why |
|-----------------|----------|-----|
| Research → Planning | Yes | Research context is bulky; plan is the distilled output |
| Planning → Implementation | Yes | Plan is in the task list or a file; free up context for code |
| Implementation → Testing | Maybe | Keep if tests reference recent code; compact if switching focus |
| Debugging → Next feature | Yes | Debug traces pollute context for unrelated work |
| Mid-implementation | No | Losing variable names, file paths, and partial state is costly |
| After a failed approach | Yes | Clear the dead-end reasoning before trying a new approach |

## What Survives Compaction

Understanding what persists helps you compact with confidence:

| Persists | Lost |
|----------|------|
| AGENTS.md / CLAUDE.md instructions | Intermediate reasoning and analysis |
| Task list | File contents you previously read |
| Memory files (Claude Code's auto memory; decision notes in the repo) | Multi-step conversation context |
| Git state (commits, branches) | Tool call history and counts |
| Files on disk | Nuanced user preferences stated verbally |

## Context Composition Awareness

Monitor what's consuming your context window:
- **AGENTS.md / CLAUDE.md files** — Always loaded, keep lean
- **Loaded skills** — Each skill adds 1-5K tokens
- **Conversation history** — Grows with each exchange
- **Tool results** — File reads, search results add bulk

Common sources of duplicate context:
- The same rule in the global AGENTS.md and a project's own AGENTS.md
- Skills that repeat AGENTS.md instructions
- Multiple skills covering overlapping domains

## Related

- AGENTS.md "Compaction Timing" table — the always-on distilled rule this skill expands
- Decision notes (`rules/decisions/`) and memory files — for state that survives compaction
