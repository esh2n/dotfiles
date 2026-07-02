---
description: Load the most recent session file from ~/.claude/session-data/ and resume work with full context from where the last session ended.
---

# Resume Session Command

Load the last saved session state and orient fully before doing any work. Counterpart to `/save-session` (which defines the session-data file format). Browse or alias saved sessions with `/sessions`.

## When to Use

- Starting a new session to continue previous work (or after a fresh start due to context limits)
- Handing off a session file from another source (provide the file path)
- Any time you want Claude to fully absorb a session file before proceeding

## Usage

```
/resume-session                                              # most recent file in ~/.claude/session-data/
/resume-session 2024-01-15                                   # most recent session for that date
/resume-session ~/.claude/session-data/2024-01-15-abc123de-session.tmp   # specific short-id file
/resume-session ~/.claude/sessions/2024-01-15-session.tmp    # specific legacy-format file
```

## Process

### Step 1: Find the session file

No argument: pick the most recently modified `*-session.tmp` in `~/.claude/session-data/`. If missing or empty, tell the user:

```
No session files found in ~/.claude/session-data/
Run /save-session at the end of a session to create one.
```

Then stop.

With an argument:

- Date (`YYYY-MM-DD`): search `~/.claude/session-data/` first, then legacy `~/.claude/sessions/`, for `YYYY-MM-DD-session.tmp` (legacy) or `YYYY-MM-DD-<shortid>-session.tmp`; load the most recently modified variant for that date
- File path: read it directly
- Not found: report clearly and stop

### Step 2: Read the entire session file

Read the complete file. Do not summarize yet.

### Step 3: Confirm understanding

Respond with a structured briefing in this exact format:

```
SESSION LOADED: [actual resolved path to the file]
════════════════════════════════════════════════

PROJECT: [project name / topic from file]

WHAT WE'RE BUILDING:
[2-3 sentence summary in your own words]

CURRENT STATE:
✅ Working: [count] items confirmed
🔄 In Progress: [list files that are in progress]
🗒️ Not Started: [list planned but untouched]

WHAT NOT TO RETRY:
[list every failed approach with its reason — this is critical]

OPEN QUESTIONS / BLOCKERS:
[list any blockers or unanswered questions]

NEXT STEP:
[exact next step if defined in the file]
[if not defined: "No next step defined — recommend reviewing 'What Has NOT Been Tried Yet' together before starting"]

════════════════════════════════════════════════
Ready to continue. What would you like to do?
```

### Step 4: Wait for the user

Do NOT start working automatically. Do NOT touch any files.

- If the next step is clearly defined and the user says "continue"/"yes" — proceed with that exact next step.
- If no next step is defined — ask where to start, optionally suggesting an approach from "What Has NOT Been Tried Yet".

---

## Edge Cases

- **Multiple sessions for the same date** (legacy no-id and short-id files): load the most recently modified matching file, regardless of format.
- **Session references files that no longer exist:** note in the briefing — "⚠️ `path/to/file.ts` referenced in session but not found on disk."
- **Session older than 7 days:** note "⚠️ This session is from N days ago (threshold: 7 days). Things may have changed." — then proceed normally.
- **User provides a file path directly (e.g., from a teammate):** read it and follow the same briefing process — the format is the same regardless of source.
- **Empty or malformed file:** report "Session file found but appears empty or unreadable. You may need to create a new one with /save-session."

---

## Notes

- Never modify the session file when loading — it's a read-only historical record
- The briefing format is fixed — do not skip sections even if empty
- "What Not To Retry" must always be shown, even if it just says "None"
- After resuming, run `/save-session` again at the end of the new session to create a new dated file
