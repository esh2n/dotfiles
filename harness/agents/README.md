# agents/

One flat directory of subagent definitions, `<name>.md`, in Claude Code's
own format (YAML frontmatter, then the system prompt as the body). It is the
one source every harness target reads: `jig apply --target claude` links
each file into `~/.claude/agents/<name>.md`; `--target codex` generates
`~/.codex/agents/<name>.toml` from it; `--target omp` generates
`~/.omp/agent/agents/<name>.md` (`../jig/README.md`, milestones 2, 3a, 3b).
The parser is `../jig/src/domain/claude/agent-definition.ts`. Every regular
`*.md` here is an agent except this README; `models.json` is the model table
(below).

## Frontmatter

| Field | Meaning | Where it goes |
|---|---|---|
| `name` | The agent's id, verbatim. Defaults to the file stem. | every target |
| `description` | When to use the agent; the harness shows it to the model that spawns subagents. | every target |
| `tools` | Claude Code tool names — a flow list (`["Read", "Grep"]`), a comma-separated scalar, or a block list. | Claude: as is. Codex: has no per-agent tool list, so the list becomes one trailing sentence of `developer_instructions`. omp: translated to omp tool ids through a fixed table; a name with no omp tool is dropped and counted. |
| `model` | A Claude tier name — `haiku`, `sonnet`, `opus` — or `inherit`. Absent means inherit. | Claude: as is. Codex and omp: looked up in `models.json` (below); a tier with no entry leaves `model` out and the dry-run counts the gap. `inherit` and absent leave `model` out, and that is not a gap: the spawner's model (Codex: explicit spawn → `[agents]` default → parent) is what it means. |
| `models` | Per-target override of the `models.json` lookup, keyed by target: `codex`, `omp`. Each entry is `{ model, reasoningEffort? }`; it wins over the tier mapping whether or not `model:` is set. Use it for the one agent that needs a different model than its tier gets. | the named target only |

Everything after the frontmatter is the prompt, copied verbatim (Codex:
`developer_instructions`; omp: the body of the generated file).

The `models` block may be written either way:

```yaml
---
name: architect
description: Plans large changes.
tools: [Read, Grep, Glob]
model: opus
models:
  codex:
    model: gpt-6-sol
    reasoningEffort: high
---
```

```yaml
models: { codex: { model: "gpt-6-sol", reasoningEffort: "high" } }
```

## `models.json`

The tier → model table for the targets that need one, one object per
target, `schemaVersion: jig.agent-models.v1`
(`../jig/src/domain/claude/agent-models.ts`):

```json
{
  "codex": { "sonnet": { "model": "gpt-6-luna", "reasoningEffort": "high" } },
  "omp": {}
}
```

- `model` — the target's own model id. Codex: a current id from
  https://learn.chatgpt.com/docs/models. omp: a provider-qualified selector
  or a `modelRoles` alias.
- `reasoningEffort` — optional. Codex writes it as `model_reasoning_effort`
  (`low | medium | high | xhigh | max | ultra`;
  https://learn.chatgpt.com/docs/config-file/config-reference). omp ignores
  it: the effort rides in the selector (`openai/gpt-5.4:high`).

An empty object for a target means "not ruled yet": every agent of that
target gets no `model` and the dry-run says so per tier. The file's
`_comment` records the ruling, the prices and the sources; changing the
mapping is an edit to this file, never to the generator.
