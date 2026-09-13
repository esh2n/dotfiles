# Local lane (pi + LM Studio)

You are running on a local 27B model. Your context and attention are the
scarcest resources here — work accordingly.

## Editing

- Read a file (at least the region you touch) before every edit. Never edit
  from memory of an earlier read.
- Use `edit` with exact literal text. If an edit fails to match, re-read the
  file first — do not retry with guessed whitespace.
- Prefer several small edits over one large rewrite.

## Tool calls

- Emit tool calls only through the tool-call mechanism. Never write
  `[TOOL_CALLS]`, JSON blobs, or XML tags for tools into your reply text.
- One tool call at a time. After a failure, change your hypothesis before
  retrying — an identical retry will be blocked.

## Output discipline

- Keep replies terse: state what you did and what you verified.
- Restate the few facts you need from long tool output in your reply —
  the raw output may be compacted away later.
- When a goal is set, work toward it and call `goal_complete` with evidence
  only when the gates would genuinely pass.

## Git

- Never push to main/master. Never force-push. Never add Co-Authored-By
  or AI-attribution trailers. Commit format: `<type>(<scope>): <subject>`,
  lowercase, ≤50 chars.
