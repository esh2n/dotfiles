---
description: Save current session state to a dated file in ~/.claude/session-data/ so work can be resumed in a future session with full context.
---

# Save Session Command

Write what was built, what worked, what failed, and what's left to a dated file so the next session picks up exactly where this one left off. Counterpart: `/resume-session`; browse saved files with `/sessions`.

## When to Use

- End of a work session, or before hitting context limits (save first, then start fresh)
- After solving a complex problem you want to remember
- Any time you need to hand off context to a future session

## Process

### Step 1: Gather context

- Read all files modified this session (git diff or recall from conversation)
- Review what was discussed, attempted, and decided
- Note errors encountered and how they were resolved (or not)
- Check current test/build status if relevant

### Step 2: Ensure the sessions folder exists

```bash
mkdir -p ~/.claude/session-data
```

### Step 3: Write the session file

Create `~/.claude/session-data/YYYY-MM-DD-<short-id>-session.tmp` (e.g. `2024-01-15-abc123de-session.tmp`), using today's actual date and a short-id satisfying `SESSION_FILENAME_REGEX` in `session-manager.js`:

- Compatibility: letters `a-z`/`A-Z`, digits, hyphens, underscores; minimum length 1
- Recommended for new files: lowercase letters, digits, and hyphens, 8+ characters

Valid: `abc123de`, `a1b2c3d4`, `frontend-worktree-1`, `ChezMoi_2`. Avoid for new files: `A`, `test_id1`, `ABC123de`.

The legacy filename `YYYY-MM-DD-session.tmp` is still valid, but new files should prefer the short-id form to avoid same-day collisions.

### Step 4: Populate every section of the format below

Write every section honestly. Never skip one — write "Nothing yet" or "N/A" if it genuinely has no content. An incomplete file is worse than an honest empty section.

### Step 5: Show the file to the user

Display the full contents and ask:

```
Session saved to [actual resolved path to the session file]

Does this look accurate? Anything to correct or add before we close?
```

Wait for confirmation. Make edits if requested.

---

## Session File Format (the contract)

```markdown
# Session: YYYY-MM-DD

**Started:** [approximate time if known]
**Last Updated:** [current time]
**Project:** [project name or path]
**Topic:** [one-line summary of what this session was about]

---

## What We Are Building

[1-3 paragraphs: what it does, why it's needed, how it fits the larger
system — enough for someone with zero memory of this session.]

---

## What WORKED (with evidence)

[Only confirmed-working items, each with WHY you know it works — test
passed, ran in browser, Postman 200. No evidence → move to "Not Tried Yet".]

- **[thing that works]** — confirmed by: [specific evidence]

If nothing is confirmed: "Nothing confirmed working yet — all approaches still in progress or untested."

---

## What Did NOT Work (and why)

[Most important section: every failed approach with the EXACT reason so the
next session doesn't retry it. "threw X error because Y", not "didn't work".]

- **[approach tried]** — failed because: [exact reason / error message]

If nothing failed: "No failed approaches yet."

---

## What Has NOT Been Tried Yet

[Promising but unattempted approaches, ideas, alternatives — specific
enough to act on.]

- [approach / idea]

If nothing is queued: "No specific untried approaches identified."

---

## Current State of Files

[Every file touched this session, with precise status.]

| File              | Status         | Notes                      |
| ----------------- | -------------- | -------------------------- |
| `path/to/file.ts` | ✅ Complete    | [what it does]             |
| `path/to/file.ts` | 🔄 In Progress | [what's done, what's left] |
| `path/to/file.ts` | ❌ Broken      | [what's wrong]             |
| `path/to/file.ts` | 🗒️ Not Started | [planned but not touched]  |

If no files were touched: "No files modified this session."

---

## Decisions Made

[Architecture choices, tradeoffs accepted, approaches chosen and why —
prevents relitigating settled decisions.]

- **[decision]** — reason: [why this was chosen over alternatives]

If none: "No major decisions made this session."

---

## Blockers & Open Questions

[Anything unresolved the next session must address; unanswered questions;
external dependencies waiting on.]

- [blocker / open question]

If none: "No active blockers."

---

## Exact Next Step

[If known: the single most important thing to do when resuming — precise
enough to require zero thinking about where to start.]

[If not known: "Next step not determined — review 'What Has NOT Been Tried Yet'
and 'Blockers' sections to decide on direction before starting."]

---

## Environment & Setup Notes

[Only if relevant — run commands, env vars, services that must be running.
If standard setup: omit this section entirely.]
```

---

## Notes

- Each session gets its own file — never append to a previous session's file
- "What Did NOT Work" is the most critical section — without it future sessions blindly retry failed approaches
- If asked to save mid-session, save what's known so far and mark in-progress items clearly
- The file is read by Claude at the start of the next session via `/resume-session`; the canonical store is `~/.claude/session-data/`
