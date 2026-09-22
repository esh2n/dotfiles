# hooks/

This directory holds **hook code jig cannot express as one of its own
subcommands** — nothing yet.

It is deliberately not the source for Claude Code's or Codex's hooks. Per
`../rules/decisions/2026-09-22-hooks-five-events.md` the five events map one
to one onto jig subcommands, and the generator writes the registration from
those commands rather than from a file here:

| Event | Command |
|---|---|
| `PreToolUse` | `jig hooks pre-tool-use --harness claude` |
| `SessionStart` | `jig hooks session-start --harness claude` |
| `UserPromptSubmit` | `jig hooks user-prompt-submit --harness claude` |
| `PostToolUse` | `jig hooks post-tool-use-format --harness claude` |
| `Stop` | `jig hooks stop-gate --harness claude` |

A `hooks/claude.json` would be a second place the same five live, and the
first one to drift. The command list above is the source; the registration is
generated (`jig apply --target claude`).

Harnesses whose hooks *are* code rather than configuration — pi and DSH, per
`../rules/decisions/2026-09-22-format-on-edit-gate-on-stop.md` — keep that code
in `../jig/adapters/<harness>/`, next to the rest of their adapter, not here.
This directory exists so the source layout named in
`../rules/decisions/2026-09-22-config-layout-no-personal-layer.md`
(`rules/ skills/ agents/ hooks/ mcp/ policy/ jig/`) is complete and so there is
one obvious home if a harness ever needs a standalone hook script.
