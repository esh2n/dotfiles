# agents/

One flat directory of subagent definitions, `<name>.md`, in Claude Code's
own format (YAML frontmatter, then the system prompt as the body). It is the
one source every harness target reads: `jig apply --target claude`
generates `~/.claude/agents/<name>.md`; `--target codex` generates
`~/.codex/agents/<name>.toml`; `--target omp` generates
`~/.omp/agent/agents/<name>.md`. The parser is
`../jig/src/domain/claude/agent-definition.ts`. Every regular `*.md` here is
an agent except this README; `models.json` is the model table (below).

Which tier and effort an agent gets is ruled by
`../rules/decisions/2026-10-19-model-assignment.md`: design and planning on
`complex` at `xhigh`, hard debugging and security review on `complex` at
`high`, reviews on `main` at `high`, exploration and plan execution on
`main` at `medium`, implementation on `main` with no effort (inherits).

## Frontmatter

| Field | Meaning | Where it goes |
|---|---|---|
| `name` | The agent's id, verbatim. Defaults to the file stem. | every target |
| `description` | When to use the agent; the harness shows it to the model that spawns subagents. | every target |
| `tools` | Claude Code tool names — a flow list (`["Read", "Grep"]`), a comma-separated scalar, or a block list. | Claude: as is. Codex: has no per-agent tool list, so the list becomes one trailing sentence of `developer_instructions`. omp: translated to omp tool ids through a fixed table; a name with no omp tool is dropped and counted. |
| `model` | A house tier — `main`, `complex`, `executor` — or `inherit`. Absent means inherit. Any other word stops the apply. | Every target looks it up in `models.json` (below) and writes that target's model; a tier with no entry leaves `model` out and the dry-run counts the gap. `inherit` and absent leave `model` out: the spawner's model is what it means. |
| `effort` | `low`, `medium`, `high`, `xhigh` or `max`. Absent means inherit. Any other word stops the apply. | Claude: `effort`. Codex: `model_reasoning_effort` (wins over the table's). omp: `thinking`. |
| `models` | Per-target override of the `models.json` lookup, keyed by target: `claude`, `codex`, `omp`. Each entry is `{ model, reasoningEffort? }`; it wins over the tier mapping whether or not `model:` is set. | the named target only |

Everything after the frontmatter is the prompt, copied verbatim (Claude:
the generated file's body; Codex: `developer_instructions`; omp: the body of
the generated file).

```yaml
---
name: architect
description: Plans large changes.
tools: [Read, Grep, Glob]
model: complex
effort: xhigh
---
```

## `models.json`

The tier → model table, one object per target, `schemaVersion:
jig.agent-models.v1` (`../jig/src/domain/claude/agent-models.ts`):

```json
{
  "claude": { "complex": { "model": "opus" }, "main": { "model": "sonnet" } },
  "codex": { "main": { "model": "gpt-6-luna" } },
  "omp": { "main": { "model": "proxy/main" } }
}
```

- `model` — the target's own model id. Claude: an alias (`opus`, `sonnet`,
  `haiku`). Codex: a current id from https://learn.chatgpt.com/docs/models.
  omp: a provider-qualified selector.
- `reasoningEffort` — optional default for agents that write no `effort:`.
  Codex writes it as `model_reasoning_effort`. omp ignores it.

An empty object for a target means "not ruled yet": every agent of that
target gets no `model` and the dry-run says so per tier. Changing the
mapping is an edit to this file, never to the generator.
