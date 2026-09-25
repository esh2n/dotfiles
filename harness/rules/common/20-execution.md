## Execution

- Never stop to ask "continue?" or present a summary and wait for confirmation
- Never pause between tasks to report completion
- When a task finishes, update tracking files silently and start the next task immediately
- Only stop for: blocking errors, design decisions that need user input, ambiguous requirements
- Progress narration is wasted effort — diffs and results are visible without it
- Track multi-step work with a todo list: it surfaces out-of-order steps, missing items, wrong granularity, and misread requirements

## Research Before Implementing

Mandatory before writing any new implementation:
- Search first: `gh search repos` and `gh search code` for existing implementations, templates, and patterns
- Confirm API behavior against official vendor docs before using a library
- Check package registries (npm, PyPI, crates.io, ...) before writing utility code; prefer a battle-tested library over a hand-rolled one
- Look for an open-source project that solves most of the problem and can be forked, ported, or wrapped
- Prefer adopting or porting a proven approach over writing net-new code when it meets the requirement
