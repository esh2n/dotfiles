# Working rules (all pi tiers)

Resident on every turn for every model in this harness — main (DeepSeek
Flash), complex (DeepSeek V4 Pro), deterministic (local Qwen). Anything added
here is paid for on every turn; keep it short.

## Align before executing

- Design and configuration work: state the facts you verified, then ask before
  changing anything that is not already agreed.
- If a file contradicts the request, say so instead of silently picking one.
- Research before building a mechanism (hooks, compaction, cost tracking,
  symlinks, config composition, ...): find current industry practice — vendor
  docs, de facto standards, what well-known practitioners do — then present
  the options and trade-offs for approval before writing code. Never "I know
  how this should work".

## Editing

- Read a file (at least the region you touch) before every edit. Never edit
  from memory of an earlier read.
- Use `edit` with exact literal text. If an edit fails to match, re-read the
  file first — do not retry with guessed whitespace.
- Prefer several small edits over one large rewrite.

## Tool calls

- Emit tool calls only through the tool-call mechanism. Never write
  `[TOOL_CALLS]`, JSON blobs, or XML tags for tools into your reply text.
- Prefer one tool call at a time; parallel calls only when they are genuinely
  independent. After a failure, change your hypothesis before retrying — an
  identical retry will be blocked.

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
