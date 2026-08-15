---
name: strategic-compact
description: Suggests manual context compaction at logical task boundaries (research→plan, milestone→next phase) instead of arbitrary auto-compaction. Use when a long session approaches context limits, when switching phases or tasks, or when deciding whether /compact would lose important context.
origin: ECC (restored 2026-08-05, rewired for yoki runtime)
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

## How It Works

The yoki hook `pre:edit-write:suggest-compact`
(`runtime/yoki/scripts/hooks/pre-edit-write-suggest-compact.js`) runs on
PreToolUse (Edit/Write/MultiEdit) and combines two signals:

1. **Context size (primary)** — Reads the latest assistant `usage` record from
   the session transcript (tail-read, fast) to get the *real* context token
   count. Suggests `/compact` when it crosses a window-scaled threshold
   (default: 160k on a 200k window, 250k on 1M), then re-reminds only after
   every 60k tokens of further growth — no repeat nagging at the same size.
2. **Edit/write call count (secondary)** — First suggestion at 50 calls, then
   every 25 calls past that. A weak proxy on its own (a few large reads can
   fill the window in very few calls); kept as a fallback for transcripts
   without usage records.

Per-session state lives in `$TMPDIR` (`claude-tool-count-<session>`,
`claude-context-bucket-<session>`) and is swept automatically after 14 days.

Registered in `core/settings.layer.json` at profile `standard,strict`
(runs through `run-with-flags.js`; disabled at `minimal`).
No manual configuration needed after `claude-switch apply`.

## Configuration

Environment variables:
- `COMPACT_CONTEXT_THRESHOLD` — Context tokens before the first suggestion
  (default: window-scaled 160k/250k; `0` disables the context signal)
- `COMPACT_CONTEXT_INTERVAL` — Tokens of further growth before a re-reminder (default: 60000)
- `YOKI_CONTEXT_WINDOW_TOKENS` — Override the detected context window size
  (also honors `CLAUDE_CODE_AUTO_COMPACT_WINDOW`); needed for windows that are
  neither 200k nor 1M
- `COMPACT_THRESHOLD` — Edit/write calls before the first count-based suggestion (default: 50)
- `COMPACT_STATE_TTL_DAYS` — Days before per-session state files are swept (default: 14)

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
(CLAUDE.md "Compaction Timing"); this is the full reasoning.

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
| CLAUDE.md instructions | Intermediate reasoning and analysis |
| Task list | File contents you previously read |
| Memory files (`~/.claude/.../memory/`) | Multi-step conversation context |
| Git state (commits, branches) | Tool call history and counts |
| Files on disk | Nuanced user preferences stated verbally |

## Division of Labor: When vs. What

Two sibling hooks cover compaction; they share a concern but never call each other:

- **This skill + `pre:edit-write:suggest-compact`** decide **when** to compact
  (advisory, PreToolUse) — the signals above
- **`pre:compact`** (`runtime/yoki/scripts/hooks/pre-compact.js`, PreCompact)
  decides **what survives** — it generates an LLM summary of the session and
  writes it into the active session `.tmp` file so the post-compaction session
  starts with a high-quality digest instead of a lossy default

## Context Composition Awareness

Monitor what's consuming your context window:
- **CLAUDE.md files** — Always loaded, keep lean
- **Loaded skills** — Each skill adds 1-5K tokens
- **Conversation history** — Grows with each exchange
- **Tool results** — File reads, search results add bulk

Common sources of duplicate context:
- Same rules in both `~/.claude/rules/` and project `.claude/rules/`
- Skills that repeat CLAUDE.md instructions
- Multiple skills covering overlapping domains

## Related

- CLAUDE.md "Compaction Timing" table — the always-on distilled rule this skill expands
- `pre:compact` hook — preserves state before compaction (see Division of Labor above)
- Memory files (`memory/` per project) — for state that survives compaction
- `continuous-learning-v2` skill — extracts patterns before session ends
