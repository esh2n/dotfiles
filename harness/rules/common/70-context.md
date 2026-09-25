## Compaction Timing

| Phase transition | Compact? |
|---|---|
| Research → Planning / Planning → Implementation | Yes — the distilled output (plan) survives |
| Debugging → next feature / after a failed approach | Yes — dead-end traces pollute context |
| Mid-implementation | No — losing file paths and partial state is costly |
| Implementation → Testing | Only when switching focus |

## Context Window Management

Avoid working in the last 20% of the context window for: large-scale refactoring, feature implementation spanning multiple files, debugging complex interactions. Lower-sensitivity tasks that tolerate it: single-file edits, independent utility creation, documentation updates, simple bug fixes.
